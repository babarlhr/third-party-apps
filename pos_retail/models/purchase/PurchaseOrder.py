from odoo import api, models, fields
import odoo
import logging

_logger = logging.getLogger(__name__)

class PurchaseOrder(models.Model):
    _inherit = "purchase.order"

    signature = fields.Binary('Signature', readonly=1)
    journal_id = fields.Many2one('account.journal', 'Vendor bill Journal')
    pos_branch_id = fields.Many2one('pos.branch', string='Branch')

    @api.model
    def create(self, vals):
        if not vals.get('pos_branch_id'):
            vals.update({'pos_branch_id': self.env['pos.branch'].sudo().get_default_branch()})
        order = super(PurchaseOrder, self).create(vals)
        return order

    @api.model
    def create_po(self, vals, purchase_order_state):
        _logger.info(vals)
        version_info = odoo.release.version_info[0]
        po = self.create(vals)
        for line in po.order_line:
            line._onchange_quantity()
        po.button_confirm()
        if purchase_order_state in ['confirm_picking']:
            for picking in po.picking_ids:
                if version_info == 10:
                    transfer = self.env['stock.immediate.transfer'].create({'pick_id': picking.id})
                    transfer.process()
                if version_info in [11, 12]:
                    for move_line in picking.move_line_ids:
                        move_line.write({'qty_done': move_line.product_uom_qty})
                    for move_line in picking.move_lines:
                        move_line.write({'quantity_done': move_line.product_uom_qty})
                    picking.button_validate()
        return {
            'name': po.name,
            'id': po.id
        }

class PurchaseOrderLine(models.Model):
    _inherit = "purchase.order.line"

    pos_branch_id = fields.Many2one('pos.branch', string='Branch')

    @api.model
    def create(self, vals):
        if not vals.get('pos_branch_id'):
            vals.update({'pos_branch_id': self.env['pos.branch'].sudo().get_default_branch()})
        order_line = super(PurchaseOrderLine, self).create(vals)
        return order_line