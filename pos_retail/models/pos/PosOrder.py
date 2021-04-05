# -*- coding: utf-8 -*-
from odoo import api, fields, models, tools, _, registry
from odoo.tools import DEFAULT_SERVER_DATETIME_FORMAT
import odoo
from odoo.exceptions import UserError
from odoo.tools import float_is_zero
import pytz
from pytz import timezone
import threading
import time

import logging
from datetime import datetime, timedelta

MAP_INVOICE_TYPE_PARTNER_TYPE = {
    'out_invoice': 'customer',
    'out_refund': 'customer',
    'out_receipt': 'customer',
    'in_invoice': 'supplier',
    'in_refund': 'supplier',
    'in_receipt': 'supplier',
}

_logger = logging.getLogger(__name__)


class POSOrder(models.Model):
    _inherit = 'pos.order'

    delivery_date = fields.Datetime('Delivery Date ')
    delivered_date = fields.Datetime('Delivered Date ')
    delivery_address = fields.Char('Delivery Address')
    delivery_phone = fields.Char('Delivery Phone', help='Phone of Customer for Shipping')
    shipping_id = fields.Many2one('res.partner', 'Shipping Address')
    statement_ids = fields.One2many(
        'account.bank.statement.line',
        'pos_statement_id',
        string='Bank Payments',
        states={'draft': [('readonly', False)]},
        readonly=True)
    picking_ids = fields.One2many('stock.picking', 'pos_order_id', 'Delivery Orders')
    promotion_ids = fields.Many2many(
        'pos.promotion',
        'pos_order_promotion_rel',
        'order_id',
        'promotion_id',
        string='Promotions')
    ean13 = fields.Char('Ean13', readonly=1)
    expire_date = fields.Datetime('Expire Date')
    is_return = fields.Boolean('Is Return')
    is_returned = fields.Boolean('Is Returned')
    add_credit = fields.Boolean('Add Credit')
    return_order_id = fields.Many2one('pos.order', 'Return from Order')
    email = fields.Char('Email')
    email_invoice = fields.Boolean('Email Invoice')
    plus_point = fields.Float('Plus Point', readonly=1)
    redeem_point = fields.Float('Redeem Points', readonly=1)
    signature = fields.Binary('Signature', readonly=1)
    parent_id = fields.Many2one('pos.order', 'Parent Order', readonly=1)
    sale_id = fields.Many2one('sale.order', 'Sale Order', readonly=1)
    partial_payment = fields.Boolean('Partial Payment')
    medical_insurance_id = fields.Many2one('medical.insurance', 'Medical Insurance')
    margin = fields.Float(
        'Margin',
        compute='_compute_margin',
        store=True
    )
    booking_id = fields.Many2one(
        'sale.order',
        'Covert from Sale Order',
        help='This order covert from Quotation Sale order',
        readonly=1)
    sale_journal = fields.Many2one('account.journal', string='Sales Journal', readonly=0, related=None, )
    location_id = fields.Many2one('stock.location', string="Source Location", related=None, readonly=1)
    pos_branch_id = fields.Many2one('pos.branch', string='Branch')
    is_paid_full = fields.Boolean('Is Paid Full', compute='_checking_payment_full')
    currency_id = fields.Many2one('res.currency', string='Currency', readonly=1, related=False)
    analytic_account_id = fields.Many2one(
        'account.analytic.account',
        'Analytic Account'
    )
    state = fields.Selection(selection_add=[
        ('quotation', 'Quotation')
    ])
    is_quotation = fields.Boolean('Is Quotation Order')

    def print_report(self):
        for order in self:
            return order.print_html_report(order.id, 'pos_retail.pos_order_template')

    def print_html_report(self, docids, reportname, data=None):
        report = self.env['ir.actions.report'].sudo()._get_report_from_name(reportname)
        html = report.render_qweb_html(docids, data=data)[0]
        return html

    def _prepare_invoice_vals(self):
        vals = super(POSOrder, self)._prepare_invoice_vals()
        vals['journal_id'] = self.sale_journal.id
        return vals

    def made_invoice(self):
        for order in self:
            order.action_pos_order_invoice()
            order.account_move.sudo().with_context(force_company=self.env.user.company_id.id).post()
        return True

    # todo: when cancel order we set all quantity of lines and payment method amount to 0
    # todo: because when pos session closing, odoo core get all total amount of line and pos payment compare before posting
    def action_pos_order_cancel(self):
        for order in self:
            if order.picking_id or order.account_move:
                raise UserError(_(
                    'Error, Order have Delivery Order or Account move, it not possible cancel, please return products'))
            order.lines.write({
                'price_unit': 0,
                'price_subtotal': 0,
                'price_subtotal_incl': 0,
            })
            order.write({'amount_total': 0})
            order.payment_ids.write({'amount': 0})
        return super(POSOrder, self).action_pos_order_cancel()

    def _is_pos_order_paid(self):
        if not self.currency_id and self.env.user.company_id.currency_id:
            self.currency_id = self.env.user.company_id.currency_id.id
        return super(POSOrder, self)._is_pos_order_paid()

    def _checking_payment_full(self):
        for order in self:
            order.is_paid_full = False
            if (order.amount_paid - order.amount_return) == order.amount_total:
                order.is_paid_full = True

    @api.depends('lines.margin')
    def _compute_margin(self):
        for order in self:
            order.margin = sum(order.mapped('lines.margin'))

    def unlink(self):
        for order in self:
            if order._is_pos_order_paid():
                raise UserError(_(
                    'Not allow remove Order have payment information. Please set to Cancel, Order Ref %s' % order.name))
            self.env['pos.cache.database'].remove_record(self._inherit, order.id)
        return super(POSOrder, self).unlink()

    def write(self, vals):
        """
        TODO: required link pos_branch_id to:
            - account bank statement and lines
            - account move and lines (x)
            - stock picking and moves, and stock moves line (x)
            - pos payment (x)
        """
        Cache = self.env['pos.cache.database'].sudo()
        res = super(POSOrder, self).write(vals)
        picking_id = vals.get('picking_id', None)
        for order in self:
            pos_branch = order.pos_branch_id
            if picking_id:
                if not order.location_id:
                    if not pos_branch:
                        self.env.cr.execute(
                            "UPDATE stock_picking SET pos_order_id=%s where id=%s" % (order.id, picking_id))
                    else:
                        self.env.cr.execute(
                            "UPDATE stock_picking SET pos_branch_id=%s, pos_order_id=%s where id=%s" % (
                                pos_branch.id, order.id, picking_id))
                else:
                    if not pos_branch:
                        self.env.cr.execute(
                            "UPDATE stock_picking SET pos_order_id=%s,location_id=%s  where id=%s" % (
                                order.id, order.location_id.id, picking_id))
                    else:
                        self.env.cr.execute(
                            "UPDATE stock_picking SET pos_branch_id=%s, pos_order_id=%s,location_id=%s  where id=%s" % (
                                pos_branch.id, order.id, order.location_id.id, picking_id))
                if pos_branch:
                    self.env.cr.execute(
                        "UPDATE stock_move SET pos_branch_id=%s WHERE picking_id=%s" % (pos_branch.id, picking_id))
                    self.env.cr.execute(
                        "UPDATE stock_move_line SET pos_branch_id=%s WHERE picking_id=%s" % (
                            pos_branch.id, picking_id))
            if vals.get('state', False) in ['paid', 'invoiced']:
                for line in order.lines:
                    self.env.cr.execute(
                        "UPDATE pos_voucher SET state='active' WHERE pos_order_line_id=%s" % (
                            line.id))  # TODO: active vouchers for customers can use, required paid done
                order.pos_compute_loyalty_point()
                order.auto_closing_backup_session()
            if order.partner_id:  # TODO: sync credit, wallet balance to pos sessions
                Cache.insert_data('res.partner', order.partner_id.id)
            Cache.insert_data(self._inherit, order.id)
            if order.partner_id:
                pos_total_amount = 0
                for order_bought in order.partner_id.pos_order_ids:
                    pos_total_amount += order_bought.amount_total
                type_will_add = self.env['res.partner.type'].get_type_from_total_amount(pos_total_amount)
                if not type_will_add:
                    type_will_add = 'Null'
                self.env.cr.execute(
                    "UPDATE res_partner SET pos_partner_type_id=%s,pos_total_amount=%s  where id=%s" % (
                        type_will_add, pos_total_amount, order.partner_id.id))
            if order.pos_branch_id:
                if order.account_move:
                    self.env.cr.execute("UPDATE account_move SET pos_branch_id=%s WHERE id=%s" % (
                        order.pos_branch_id.id, order.account_move.id))
                    self.env.cr.execute("UPDATE account_move_line SET pos_branch_id=%s WHERE move_id=%s" % (
                        order.pos_branch_id.id, order.account_move.id))
        return res

    @api.model
    def auto_closing_backup_session(self):
        if self.session_id and self.session_id.backup_session:
            orders_not_paid = self.search([
                ('state', 'not in', ['paid', 'invoiced']),
                ('id', '!=', self.id),
                ('session_id', '=', self.session_id.id)
            ])
            if not orders_not_paid:
                self.session_id.close_session_and_validate()
        return True
    @api.model
    def create(self, vals):
        Cache = self.env['pos.cache.database'].sudo()
        Location = self.env['stock.location'].sudo()
        Session = self.env['pos.session'].sudo()
        session = Session.browse(vals.get('session_id'))
        if not vals.get('location_id', None):
            vals.update({
                'location_id': session.config_id.stock_location_id.id if session.config_id.stock_location_id else None
            })
        else:
            location = Location.browse(vals.get('location_id'))
            vals.update({
                'location_id': location.id
            })
        if not vals.get('sale_journal', None):
            vals.update({'sale_journal': session.config_id.journal_id.id})
        if session.config_id.pos_branch_id:
            vals.update({'pos_branch_id': session.config_id.pos_branch_id.id})
        if not vals.get('currency_id', None) and session.config_id.currency_id:
            vals.update({'currency_id': session.config_id.currency_id.id})
        combo_item_dict = {}
        product_combo_items_dict = {}
        if vals and vals.get('lines', []):
            for line in vals.get('lines', []):
                line = line[2]
                combo_item_ids = line.get('combo_item_ids', None)
                if combo_item_ids:
                    for combo_item in combo_item_ids:
                        if combo_item['quantity'] <= 0:
                            continue
                        if not combo_item_dict.get(combo_item['id']):
                            combo_item_dict[combo_item['id']] = combo_item['quantity'] * line['qty']
                        else:
                            combo_item_dict[combo_item['id']] += combo_item['quantity'] * line['qty']
                    del line['combo_item_ids']
                selected_combo_items = line.get('selected_combo_items', None)
                if selected_combo_items:
                    for product_id, quantity in selected_combo_items.items():
                        if not product_combo_items_dict.get(product_id, False):
                            product_combo_items_dict[int(product_id)] = quantity
                        else:
                            product_combo_items_dict[int(product_id)] += quantity
                    del line['selected_combo_items']
        if not vals.get('pos_branch_id'):
            vals.update({'pos_branch_id': self.env['pos.branch'].sudo().get_default_branch()})
        order = super(POSOrder, self).create(vals)
        if combo_item_dict:
            order.create_picking_combo(combo_item_dict)
        if product_combo_items_dict:
            order.create_picking_combo_items(product_combo_items_dict)
        Cache.insert_data(self._inherit, order.id)
        if order.plus_point or order.redeem_point:
            order.pos_compute_loyalty_point()
        if order.return_order_id:
            order.return_order_id.write({'is_returned': True})
        return order

    def action_pos_order_send(self):
        if not self.partner_id:
            raise Warning(_('Customer not found on this Point of Sale Orders.'))
        self.ensure_one()
        template = self.env.ref('pos_retail.email_template_edi_pos_orders', False)
        compose_form = self.env.ref('mail.email_compose_message_wizard_form', False)
        ctx = dict(
            default_model='pos.order',
            default_res_id=self.id,
            default_use_template=bool(template),
            default_template_id=template and template.id or False,
            default_composition_mode='comment',
        )
        return {
            'name': _('Compose Email'),
            'type': 'ir.actions.act_window',
            'view_type': 'form',
            'view_mode': 'form',
            'res_model': 'mail.compose.message',
            'views': [(compose_form.id, 'form')],
            'view_id': compose_form.id,
            'target': 'new',
            'context': ctx,
        }

    def add_payment(self, data):
        if self.pos_branch_id:
            data.update({'pos_branch_id': self.pos_branch_id.id})
        if data.get('name', None) == 'return':
            order = self.browse(data.get('pos_order_id'))
            if order.currency_id and self.env.user.company_id.currency_id and order.currency_id.id != self.env.user.company_id.currency_id.id:
                customer_payment = self.env['pos.payment'].search([('pos_order_id', '=', order.id)], limit=1)
                if customer_payment:
                    data.update({
                        'payment_method_id': customer_payment.payment_method_id.id
                    })
        res = super(POSOrder, self).add_payment(data)
        self.env['pos.cache.database'].insert_data(self._inherit, self.id)
        return res

    def made_purchase_order(self):
        # TODO: create 1 purchase get products return from customer
        customer_return = self.env['res.partner'].search([('name', '=', 'Customer return')])
        po = self.env['purchase.order'].create({
            'partner_id': self.partner_id.id if self.partner_id else customer_return[0].id,
            'name': 'Return/' + self.name,
        })
        for line in self.lines:
            if line.qty < 0:
                self.env['purchase.order.line'].create({
                    'order_id': po.id,
                    'name': 'Return/' + line.product_id.name,
                    'product_id': line.product_id.id,
                    'product_qty': - line.qty,
                    'product_uom': line.product_id.uom_po_id.id,
                    'price_unit': line.price_unit,
                    'date_planned': datetime.today().strftime(DEFAULT_SERVER_DATETIME_FORMAT),
                })
        po.button_confirm()
        for picking in po.picking_ids:
            picking.action_assign()
            picking.force_assign()
            wrong_lots = self.set_pack_operation_lot(picking)
            if not wrong_lots:
                picking.action_done()
        return True

    def set_done(self):
        return self.write({'state': 'done'})

    @api.model
    def _order_fields(self, ui_order):
        order_fields = super(POSOrder, self)._order_fields(ui_order)
        if ui_order.get('add_credit', False):
            order_fields.update({
                'add_credit': ui_order['add_credit']
            })
        if ui_order.get('medical_insurance_id', False):
            order_fields.update({
                'medical_insurance_id': ui_order['medical_insurance_id']
            })
        if ui_order.get('partial_payment', False):
            order_fields.update({
                'partial_payment': ui_order['partial_payment']
            })
        if ui_order.get('sale_id', False):
            order_fields.update({
                'sale_id': ui_order['sale_id']
            })
        if ui_order.get('delivery_date', False):
            order_fields.update({
                'delivery_date': ui_order['delivery_date']
            })
        if ui_order.get('delivery_address', False):
            order_fields.update({
                'delivery_address': ui_order['delivery_address']
            })
        if ui_order.get('parent_id', False):
            order_fields.update({
                'parent_id': ui_order['parent_id']
            })
        if ui_order.get('sale_journal', False):
            order_fields['sale_journal'] = ui_order.get('sale_journal')
        if ui_order.get('ean13', False):
            order_fields.update({
                'ean13': ui_order['ean13']
            })
        if ui_order.get('expire_date', False):
            order_fields.update({
                'expire_date': ui_order['expire_date']
            })
        if ui_order.get('is_return', False):
            order_fields.update({
                'is_return': ui_order['is_return']
            })
        if ui_order.get('email', False):
            order_fields.update({
                'email': ui_order.get('email')
            })
        if ui_order.get('email_invoice', False):
            order_fields.update({
                'email_invoice': ui_order.get('email_invoice')
            })
        if ui_order.get('plus_point', 0):
            order_fields.update({
                'plus_point': ui_order['plus_point']
            })
        if ui_order.get('redeem_point', 0):
            order_fields.update({
                'redeem_point': ui_order['redeem_point']
            })
        if ui_order.get('note', None):
            order_fields.update({
                'note': ui_order['note']
            })
        if ui_order.get('return_order_id', False):
            order_fields.update({
                'return_order_id': ui_order['return_order_id']
            })
        if ui_order.get('location_id', False):
            order_fields.update({
                'location_id': ui_order['location_id']
            })
        if ui_order.get('booking_id', False):
            order_fields.update({
                'booking_id': ui_order['booking_id']
            })
        if ui_order.get('currency_id', False):
            order_fields.update({
                'currency_id': ui_order['currency_id']
            })
        if ui_order.get('analytic_account_id', False):
            order_fields.update({
                'analytic_account_id': ui_order['analytic_account_id']
            })
        if ui_order.get('combo_item_ids', False):
            order_fields.update({
                'combo_item_ids': ui_order['combo_item_ids']
            })
        if ui_order.get('shipping_id'):
            order_fields.update({
                'shipping_id': ui_order['shipping_id']
            })
        return order_fields

    @api.model
    def get_code(self, code):
        return self.env['barcode.nomenclature'].sudo().sanitize_ean(code)

    @api.model
    def _process_order(self, order, draft, existing_order):
        recheck_existing_order = self.search([
            ('pos_reference', '=', order['data']['name'])
        ], limit=1)
        if recheck_existing_order:
            _logger.info(
                'Order %s exist before, order existed ID %s' % (order['data']['name'], recheck_existing_order.id))
            return recheck_existing_order.id
        return super(POSOrder, self)._process_order(order, draft, existing_order)

    def _process_payment_lines(self, pos_order, order, pos_session, draft):
        """
            - Reason we force this method of odoo bellow:
            1) If pos session use another pricelist have currency difference with pos config company currency
            2) have one statement rounding example: 0.11 VND inside statement_ids
            3) when order push to backend and currency VND have prec_acc = order.pricelist_id.currency_id.decimal_places is 1.0 (*)
            4) and method float_is_zero check 0.11 is 0 and if not float_is_zero(payments[2]['amount'], precision_digits=prec_acc) with be true
            5) if (4) true, _process_payment_lines not add statement rounding amount 0.11
            6) and when pos session action closing session and post entries, post entries will compare debit and credit and missed 0.11 VND
            7) And session could not close
            - So solution now is:
            1) if have order (pricelist >> currency) difference with company currency
            2) we not call parent method of odoo original
            3) we only check statement line have amount not zero and allow create rounding statement
            ---- END ----
        """
        company_currency = pos_session.config_id.company_id.currency_id
        company_currency_id = None
        if company_currency:
            company_currency_id = company_currency.id
        pricelist_currency_id = order.pricelist_id.currency_id.id
        pricelist_currency_difference_company_currency = False
        if company_currency_id and company_currency_id != pricelist_currency_id:
            pricelist_currency_difference_company_currency = True
        if not pricelist_currency_difference_company_currency:
            return super(POSOrder, self)._process_payment_lines(pos_order, order, pos_session, draft)
        else:
            order_bank_statement_lines = self.env['pos.payment'].search([('pos_order_id', '=', order.id)])
            order_bank_statement_lines.unlink()
            for payments in pos_order['statement_ids']:
                if payments[2]['amount'] != 0:
                    order.add_payment(self._payment_fields(order, payments[2]))
            order.amount_paid = sum(order.payment_ids.mapped('amount'))
            if order.config_id.turbo_sync_orders:
                draft = True
                _logger.info('Turbo Sync Order: %s' % order.id)
            turbo_sync_order = order.config_id.turbo_sync_orders and pos_order['amount_return'] != 0
            if (not draft and pos_order['amount_return'] != 0) or turbo_sync_order:
                cash_payment_method = pos_session.payment_method_ids.filtered('is_cash_count')[:1]
                if not cash_payment_method:
                    raise UserError(_("No cash statement found for this session. Unable to record returned cash."))
                return_payment_vals = {
                    'name': _('return'),
                    'pos_order_id': order.id,
                    'amount': -pos_order['amount_return'],
                    'payment_date': fields.Date.context_today(self),
                    'payment_method_id': cash_payment_method.id,
                }
                order.add_payment(return_payment_vals)

    @api.model
    def create_from_ui(self, orders, draft=False):
        for o in orders:
            data = o['data']
            lines = data.get('lines')
            for line_val in lines:
                line = line_val[2]
                new_line = {}
                for key, value in line.items():
                    if key not in [
                        'creation_time',
                        'mp_dirty',
                        'mp_skip',
                        'quantity_wait',
                        'state',
                        'tags',
                        'quantity_done',
                        'promotion_discount_total_order',
                        'promotion_discount_category',
                        'promotion_discount_by_quantity',
                        'promotion_discount',
                        'promotion_gift',
                        'promotion_price_by_quantity',
                    ]:
                        new_line[key] = value
                try:
                    line_val[2] = new_line
                except:
                    _logger.info('testing fail')
        res = super(POSOrder, self).create_from_ui(orders, draft=draft)
        for order_value in res:
            order_value['order_fields_extend'] = {}
            order_value['delivery_fields_extend'] = {}
            order_value['invoice_fields_extend'] = {}
            order = self.browse(order_value['id'])
            order.pos_compute_loyalty_point()
            order.create_picking_variants()
            if order.add_credit and order.amount_total < 0:
                order.add_credit(- order.amount_total)
            # TODO: for invoice offline mode. Invoice will create few second order submitted
            if order.partner_id and order.config_id.invoice_offline and order.partner_id:
                self.env.cr.commit()
                threaded_synchronization = threading.Thread(target=self.create_invoice_offline, args=(
                    order.id, order.config_id.invoice_offline_auto_register_payment))
                threaded_synchronization.start()
            if order.config_id.add_order_fields_to_receipt:
                field_description_by_name = {}
                field_format_datetime = []
                fields_read = []
                for fd in order.config_id.add_order_fields_to_receipt:
                    field_description_by_name[fd.name] = fd.field_description
                    fields_read.append(fd.name)
                    if fd.ttype in ['date', 'datetime']:
                        field_format_datetime.append(fd.name)
                values = order.sudo().with_context(tz=self.env.user.tz).search_read([('id', '=', order.id)], fields_read)[0]
                for field, value in values.items():
                    if field == 'id' or not value:
                        continue
                    if field in field_format_datetime:
                        value = self.env['pos.session'].get_session_date(value)
                    order_value['order_fields_extend'][field_description_by_name[field]] = value
            if order.picking_id and order.config_id.add_picking_field_to_receipt:
                order_value['picking_ref'] = order.picking_id.read([order.config_id.add_picking_field_to_receipt])[
                    0].get(order.config_id.add_picking_field_to_receipt)
            if order.picking_id and order.config_id.add_picking_fields_to_receipt:
                field_description_by_name = {}
                field_format_datetime = []
                fields_read = []
                for fd in order.config_id.add_picking_fields_to_receipt:
                    field_description_by_name[fd.name] = fd.field_description
                    fields_read.append(fd.name)
                    if fd.ttype in ['date', 'datetime']:
                        field_format_datetime.append(fd.name)
                values = order.picking_id.sudo().with_context(tz=self.env.user.tz).search_read(
                    [('id', '=', order.picking_id.id)], fields_read)[0]
                for field, value in values.items():
                    if field == 'id' or not value:
                        continue
                    if field in field_format_datetime:
                        value = self.env['pos.session'].get_session_date(value)
                    order_value['delivery_fields_extend'][field_description_by_name[field]] = value
            if order.account_move and order.config_id.add_invoice_field_to_receipt:
                order_value['invoice_ref'] = order.account_move.read([order.config_id.add_invoice_field_to_receipt])[
                    0].get(order.config_id.add_invoice_field_to_receipt)
            if order.account_move and order.config_id.add_invoices_field_to_receipt:
                field_description_by_name = {}
                field_format_datetime = []
                fields_read = []
                for fd in order.config_id.add_invoices_field_to_receipt:
                    field_description_by_name[fd.name] = fd.field_description
                    fields_read.append(fd.name)
                    if fd.ttype in ['date', 'datetime']:
                        field_format_datetime.append(fd.name)
                values = order.account_move.sudo().with_context(tz=self.env.user.tz).search_read(
                    [('id', '=', order.account_move.id)], fields_read)[0]
                for field, value in values.items():
                    if field == 'id' or not value:
                        continue
                    if field in field_format_datetime:
                        value = self.env['pos.session'].get_session_date(value)
                    order_value['invoice_fields_extend'][field_description_by_name[field]] = value
            order_value['ean13'] = order['ean13']
        return res

    def create_invoice_offline(self, order_id, auto_register_payment=False):
        with api.Environment.manage():
            new_cr = registry(self._cr.dbname).cursor()
            self = self.with_env(self.env(cr=new_cr))
            pos_order = self.browse(order_id)
            if not pos_order.account_move:
                pos_order.action_pos_order_invoice()
            if auto_register_payment:
                payment_val = {
                    'partner_type': MAP_INVOICE_TYPE_PARTNER_TYPE[pos_order.account_move.type],
                    'payment_type': 'inbound',
                    'partner_id': pos_order.partner_id.id,
                    'amount': pos_order.account_move.amount_residual,
                    'currency_id': pos_order.account_move.currency_id.id if pos_order.account_move.currency_id else None,
                    'payment_date': fields.Date.today(),
                    'journal_id': pos_order.sale_journal.id,
                    'payment_method_id': pos_order.sale_journal.inbound_payment_method_ids[
                        0].id if pos_order.sale_journal.inbound_payment_method_ids else None,
                    'invoice_ids': [[6, 0, [pos_order.account_move.id]]]
                }
                payment = self.env['account.payment'].create(payment_val)
                payment.post()
            new_cr.commit()
            new_cr.close()
            return True

    def pos_compute_loyalty_point(self):
        if self.partner_id and self.config_id and self.config_id.loyalty_id and (
                self.redeem_point or self.plus_point):
            self.env.cr.execute("select id from pos_loyalty_point where order_id=%s and type='plus'" % self.id)
            have_plus = self.env.cr.fetchall()
            self.env.cr.execute("select id from pos_loyalty_point where order_id=%s and type='redeem'" % self.id)
            have_redeem = self.env.cr.fetchall()
            vals_point = {
                'loyalty_id': self.config_id.loyalty_id.id,
                'order_id': self.id,
                'partner_id': self.partner_id.id,
                'state': 'ready',
                'is_return': self.is_return if self.is_return else False,
            }
            if self.plus_point and len(have_plus) == 0:
                vals_point.update({
                    'point': self.plus_point,
                    'type': 'plus'
                })
                self.env['pos.loyalty.point'].create(vals_point)
            if self.redeem_point and len(have_redeem) == 0:
                vals_point.update({
                    'point': self.redeem_point,
                    'type': 'redeem'
                })
                self.env['pos.loyalty.point'].create(vals_point)

    @api.model
    def add_credit(self, amount):
        if self.partner_id:
            credit_object = self.env['res.partner.credit']
            credit = credit_object.create({
                'name': self.name,
                'type': 'plus',
                'amount': amount,
                'pos_order_id': self.id,
                'partner_id': self.partner_id.id,
            })
            return self.env['pos.cache.database'].insert_data('res.partner', credit.partner_id.id)
        else:
            return False

    def create_picking_combo(self, combo_item_dict):
        if combo_item_dict:
            _logger.info('Begin create_picking_combo()')
            _logger.info(combo_item_dict)
            warehouse_obj = self.env['stock.warehouse']
            move_object = self.env['stock.move']
            moves = move_object
            picking_obj = self.env['stock.picking']
            picking_type = self.picking_type_id
            location_id = self.location_id.id
            if self.partner_id:
                destination_id = self.partner_id.property_stock_customer.id
            else:
                if (not picking_type) or (not picking_type.default_location_dest_id):
                    customerloc, supplierloc = warehouse_obj._get_partner_locations()
                    destination_id = customerloc.id
                else:
                    destination_id = picking_type.default_location_dest_id.id
            is_return = self.is_return
            picking_vals = {
                'is_picking_combo': True,
                'user_id': False,
                'origin': self.name,
                'partner_id': self.partner_id.id if self.partner_id else None,
                'date_done': self.date_order,
                'picking_type_id': picking_type.id,
                'company_id': self.company_id.id,
                'move_type': 'direct',
                'note': self.note or "",
                'location_id': location_id if not is_return else destination_id,
                'location_dest_id': destination_id if not is_return else location_id,
                'pos_order_id': self.id,
            }
            picking_combo = picking_obj.create(picking_vals)
            for combo_item_id, product_uom_qty in combo_item_dict.items():
                combo_item = self.env['pos.combo.item'].browse(combo_item_id)
                product = combo_item.product_id
                vals = {
                    'name': self.name,
                    'combo_item_id': combo_item.id,
                    'product_uom': product.uom_id.id,
                    'picking_id': picking_combo.id,
                    'picking_type_id': picking_type.id,
                    'product_id': product.id,
                    'product_uom_qty': product_uom_qty,
                    'state': 'draft',
                    'location_id': location_id if not is_return else destination_id,
                    'location_dest_id': destination_id if not is_return else location_id,
                }
                move = move_object.create(vals)
                moves |= move
                _logger.info(vals)
            picking_combo.action_assign()
            picking_combo.action_done()
        return True

    def create_picking_combo_items(self, combo_item_dict):
        if combo_item_dict:
            _logger.info('Begin create_picking_combo()')
            _logger.info(combo_item_dict)
            warehouse_obj = self.env['stock.warehouse']
            move_object = self.env['stock.move']
            moves = move_object
            picking_obj = self.env['stock.picking']
            picking_type = self.picking_type_id
            location_id = self.location_id.id
            if self.partner_id:
                destination_id = self.partner_id.property_stock_customer.id
            else:
                if (not picking_type) or (not picking_type.default_location_dest_id):
                    customerloc, supplierloc = warehouse_obj._get_partner_locations()
                    destination_id = customerloc.id
                else:
                    destination_id = picking_type.default_location_dest_id.id
            is_return = self.is_return
            picking_vals = {
                'is_picking_combo': True,
                'user_id': False,
                'origin': self.name,
                'partner_id': self.partner_id.id if self.partner_id else None,
                'date_done': self.date_order,
                'picking_type_id': picking_type.id,
                'company_id': self.company_id.id,
                'move_type': 'direct',
                'note': self.note or "",
                'location_id': location_id if not is_return else destination_id,
                'location_dest_id': destination_id if not is_return else location_id,
                'pos_order_id': self.id,
            }
            picking_combo = picking_obj.create(picking_vals)
            for product_id, quantity in combo_item_dict.items():
                product = self.env['product.product'].browse(product_id)
                vals = {
                    'name': self.name,
                    'product_uom': product.uom_id.id,
                    'picking_id': picking_combo.id,
                    'picking_type_id': picking_type.id,
                    'product_id': product_id,
                    'product_uom_qty': quantity,
                    'state': 'draft',
                    'location_id': location_id if not is_return else destination_id,
                    'location_dest_id': destination_id if not is_return else location_id,
                }
                move = move_object.create(vals)
                moves |= move
                _logger.info(vals)
            picking_combo.action_assign()
            picking_combo.action_done()
        return True

    def create_picking_variants(self):
        lines_included_variants = self.lines.filtered(
            lambda l: len(l.variant_ids) > 0)
        if lines_included_variants:
            condition_create_picking = False
            for order_line in lines_included_variants:
                for variant_item in order_line.variant_ids:
                    if variant_item.product_id:
                        condition_create_picking = True
                        break
            if not condition_create_picking:
                return True
            warehouse_obj = self.env['stock.warehouse']
            move_object = self.env['stock.move']
            moves = move_object
            picking_obj = self.env['stock.picking']
            picking_type = self.picking_type_id
            location_id = self.location_id.id
            if self.partner_id:
                destination_id = self.partner_id.property_stock_customer.id
            else:
                if (not picking_type) or (not picking_type.default_location_dest_id):
                    customerloc, supplierloc = warehouse_obj._get_partner_locations()
                    destination_id = customerloc.id
                else:
                    destination_id = picking_type.default_location_dest_id.id
            is_return = self.is_return
            picking_vals = {
                'name': self.name + '- Variants',
                'origin': self.name,
                'partner_id': self.partner_id.id if self.partner_id else None,
                'date_done': self.date_order,
                'picking_type_id': picking_type.id,
                'company_id': self.company_id.id,
                'move_type': 'direct',
                'note': self.note or "",
                'location_id': location_id if not is_return else destination_id,
                'location_dest_id': destination_id if not is_return else location_id,
                'pos_order_id': self.id,
            }
            picking_variants = picking_obj.create(picking_vals)
            for order_line in lines_included_variants:
                for variant_item in order_line.variant_ids:
                    if not variant_item.product_id:
                        continue
                    product = variant_item.product_id
                    order_line_qty = order_line.qty
                    move = move_object.create({
                        'name': self.name,
                        'product_uom': product.uom_id.id,
                        'picking_id': picking_variants.id,
                        'picking_type_id': picking_type.id,
                        'product_id': product.id,
                        'product_uom_qty': abs(variant_item.quantity * order_line_qty),
                        'state': 'draft',
                        'location_id': location_id if not is_return else destination_id,
                        'location_dest_id': destination_id if not is_return else location_id,
                    })
                    moves |= move
            self._force_picking_done(picking_variants)
        return True

    def create_stock_move_with_lot(self, stock_move=None, lot_name=None):
        """set lot serial combo items"""
        """Set Serial/Lot number in pack operations to mark the pack operation done."""
        version_info = odoo.release.version_info
        if version_info and version_info[0] in [11, 12]:
            stock_production_lot = self.env['stock.production.lot']
            lots = stock_production_lot.search([('name', '=', lot_name)])
            if lots:
                self.env['stock.move.line'].create({
                    'move_id': stock_move.id,
                    'product_id': stock_move.product_id.id,
                    'product_uom_id': stock_move.product_uom.id,
                    'qty_done': stock_move.product_uom_qty,
                    'location_id': stock_move.location_id.id,
                    'location_dest_id': stock_move.location_dest_id.id,
                    'lot_id': lots[0].id,
                })
        return True

    @api.model
    def _payment_fields(self, order, ui_paymentline):
        payment_fields = super(POSOrder, self)._payment_fields(order, ui_paymentline)
        if ui_paymentline.get('voucher_id', None):
            payment_fields['voucher_id'] = ui_paymentline.get('voucher_id')
        if ui_paymentline.get('ref', None):
            payment_fields['ref'] = ui_paymentline.get('ref')
        return payment_fields


class POSOrderLine(models.Model):
    _inherit = "pos.order.line"

    plus_point = fields.Float('Plus Point', readonly=1)
    redeem_point = fields.Float('Redeem Point', readonly=1)
    partner_id = fields.Many2one(
        'res.partner',
        related='order_id.partner_id',
        string='Partner',
        readonly=1)
    promotion = fields.Boolean('Applied Promotion', readonly=1)
    promotion_id = fields.Many2one('pos.promotion', 'Promotion', readonly=1, ondelete="set null")
    promotion_reason = fields.Char(string='Promotion Reason', readonly=1)
    is_return = fields.Boolean('Is Return')
    order_uid = fields.Text('order_uid', readonly=1)
    user_id = fields.Many2one('res.users', 'Sale Person')
    session_info = fields.Text('session_info', readonly=1)
    uid = fields.Text('uid', readonly=1)
    variant_ids = fields.Many2many(
        'product.variant',
        'order_line_variant_rel',
        'line_id', 'variant_id',
        string='Variant Items', readonly=1)
    tag_ids = fields.Many2many(
        'pos.tag',
        'pos_order_line_tag_rel',
        'line_id',
        'tag_id',
        string='Tags / Reasons Return')
    note = fields.Text('Note')
    discount_reason = fields.Char('Discount Reason')
    medical_insurance = fields.Boolean('Discount Medical Insurance')
    margin = fields.Float(
        'Margin',
        compute='_compute_multi_margin',
        store=True,
        multi='multi_margin',
    )
    margin_percent = fields.Float(
        'Margin %',
        compute='_compute_multi_margin',
        store=True,
        multi='multi_margin',
    )
    purchase_price = fields.Float(
        'Cost Price',
        compute='_compute_multi_margin',
        store=True,
        multi='multi_margin')
    reward_id = fields.Many2one('pos.loyalty.reward', 'Reward')
    packaging_id = fields.Many2one('product.packaging', string='Package/Box')
    config_id = fields.Many2one(
        'pos.config',
        related='order_id.session_id.config_id',
        string="Point of Sale")
    pos_branch_id = fields.Many2one(
        'pos.branch',
        related='order_id.pos_branch_id',
        string='Branch',
        readonly=1,
        index=True,
        store=True)
    manager_user_id = fields.Many2one('res.users', 'Manager Approved')
    analytic_account_id = fields.Many2one(
        'account.analytic.account',
        related='order_id.analytic_account_id',
        store=True,
        readonly=1,
        string='Analytic Account'
    )
    returned_qty = fields.Float('Returned Qty')
    returned_order_line_id = fields.Many2one('pos.order.line', 'Returned from Line')
    uom_id = fields.Many2one('uom.uom', 'Uom', readonly=1)

    @api.depends('product_id', 'qty', 'price_subtotal', 'order_id.note')
    def _compute_multi_margin(self):
        for line in self:
            if line.qty <= 0:
                continue
            if line.price_subtotal <= 0:
                line.purchase_price = 0
                line.margin = 0
                line.margin_percent = 0
                continue
            if not line.product_id:
                line.purchase_price = 0
                line.margin = 0
                line.margin_percent = 0
            else:
                line.purchase_price = line.product_id.standard_price
                line.margin = line.price_subtotal - (
                        line.product_id.standard_price * line.qty)
                if line.product_id.standard_price <= 0:
                    line.margin_percent = 100
                else:
                    line.margin_percent = (
                                                  line.price_subtotal / line.qty - line.product_id.standard_price) / line.product_id.standard_price * 100

    def _order_line_fields(self, line, session_id=None):
        values = super(POSOrderLine, self)._order_line_fields(line, session_id)
        if line[2].get('combo_item_ids', []):
            values[2].update({'combo_item_ids': line[2].get('combo_item_ids', [])})
        if line[2].get('selected_combo_items', []):
            values[2].update({'selected_combo_items': line[2].get('selected_combo_items', [])})
        if line[2].get('voucher', None):
            values[2].update({'voucher': line[2].get('voucher', [])})
        return values

    # TODO: cashier add voucher variable to each line, backend automatic create voucher
    def _add_voucher(self, order, voucher_vals=[]):
        today = datetime.today()
        if voucher_vals.get('period_days', None):
            end_date = today + timedelta(days=int(voucher_vals['period_days']))
        else:
            end_date = today + timedelta(days=order.config_id.expired_days_voucher)
        self.env['pos.voucher'].sudo().create({
            'number': voucher_vals.get('number', None) if voucher_vals.get('number', None) else '',
            'customer_id': voucher_vals.get('customer_id', None) if voucher_vals.get('customer_id', None) else None,
            'start_date': fields.Datetime.now(),
            'end_date': end_date,
            'state': 'active',
            'value': voucher_vals['value'],
            'apply_type': voucher_vals.get('apply_type', None) if voucher_vals.get('apply_type',
                                                                                   None) else 'fixed_amount',
            'method': voucher_vals.get('method', None) if voucher_vals.get('method', None) else 'general',
            'source': order.name,
            'pos_order_id': order.id,
            'pos_order_line_id': self.id,
            'user_id': self.env.user.id
        })

    @api.model
    def create(self, vals):
        voucher_vals = {}
        if vals.get('voucher', {}):
            voucher_vals = vals.get('voucher')
            del vals['voucher']
        if vals.get('mp_skip', {}):
            del vals['mp_skip']
        if 'voucher' in vals:
            del vals['voucher']
        order = self.env['pos.order'].browse(vals['order_id'])
        if order.booking_id and order.booking_id.state != 'booked':
            order.booking_id.write({
                'pos_order_id': order.id,
                'payment_partial_amount': 0,
                'state': 'booked'
            })
        if order.pos_branch_id:
            vals.update({'pos_branch_id': order.pos_branch_id.id})
        else:
            vals.update({'pos_branch_id': self.env['pos.branch'].sudo().get_default_branch()})
        po_line = super(POSOrderLine, self).create(vals)
        if voucher_vals:
            po_line._add_voucher(order, voucher_vals)
        if po_line.product_id.is_credit:
            po_line.order_id.add_credit(po_line.price_subtotal_incl)
        self.env['pos.cache.database'].insert_data(self._inherit, po_line.id)
        if po_line.returned_order_line_id:
            po_line.returned_order_line_id.write({'returned_qty': po_line.qty})
        if vals.get('uom_id', None):
            product = self.env['product.product'].browse(vals.get('product_id'))
            line_uom = self.env['uom.uom'].browse(vals.get('uom_id'))
            base_uom = product.uom_id
            if base_uom.category_id == line_uom.category_id and po_line.product_id.uom_id.factor_inv != 0:
                before_total = po_line.price_unit * po_line.qty
                line_qty = po_line.qty
                new_qty = line_qty * (line_uom.factor_inv / po_line.product_id.uom_id.factor_inv)
                if new_qty != 0:
                    new_price = before_total / new_qty
                    po_line.write({
                        'name': '%s_sale_(%s)' % (po_line.name, line_uom.name),
                        'qty': new_qty,
                        'price_unit': new_price,
                    })
        return po_line

    @api.model
    def write(self, vals):
        res = super(POSOrderLine, self).write(vals)
        for po_line in self:
            self.env['pos.cache.database'].insert_data(self._inherit, po_line.id)
        return res

    def unlink(self):
        for record in self:
            self.env['pos.cache.database'].remove_record(self._inherit, record.id)
        return super(POSOrderLine, self).unlink()

    def get_purchased_lines_histories_by_partner_id(self, partner_id):
        orders = self.env['pos.order'].sudo().search([('partner_id', '=', partner_id)], order='create_date DESC')
        fields_sale_load = self.env['pos.cache.database'].sudo().get_fields_by_model('pos.order.line')
        vals = []
        if orders:
            order_ids = [order.id for order in orders]
            lines = self.sudo().search([('order_id', 'in', order_ids)])
            return lines.read(fields_sale_load)
        else:
            return vals
