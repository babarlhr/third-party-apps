# -*- coding: utf-8 -*-
from odoo import fields, api, models
import odoo

import logging
_logger = logging.getLogger(__name__)

class stock_picking(models.Model):
    _inherit = "stock.picking"

    is_picking_combo = fields.Boolean('Is Picking Combo')
    pos_order_id = fields.Many2one('pos.order', 'POS order')
    pos_branch_id = fields.Many2one('pos.branch', string='Branch')

    @api.model
    def create(self, vals):
        PosOrder = self.env['pos.order'].sudo()
        if vals.get('pos_order_id', None):
            order = PosOrder.browse(vals.get('pos_order_id'))
            if order.config_id and order.config_id.pos_branch_id:
                vals.update({'pos_branch_id': order.config_id.pos_branch_id.id})
        if not vals.get('pos_branch_id'):
            vals.update({'pos_branch_id': self.env['pos.branch'].sudo().get_default_branch()})
        picking = super(stock_picking, self).create(vals)
        if picking.sale_id:
            self.env['pos.cache.database'].insert_data('sale.order', picking.sale_id.id)
        return picking

    def write(self, vals):
        PosOrder = self.env['pos.order'].sudo()
        if vals.get('pos_order_id', None):
            order = PosOrder.browse(vals.get('pos_order_id'))
            if order.config_id and order.config_id.pos_branch_id:
                vals.update({'pos_branch_id': order.config_id.pos_branch_id.id})
        datas = super(stock_picking, self).write(vals)
        for picking in self:
            if picking.sale_id:
                self.env['pos.cache.database'].insert_data('sale.order', picking.sale_id.id)
        return datas

    @api.model
    def pos_made_internal_transfer(self, picking_vals, move_lines):
        Move = self.env['stock.move.line'].sudo()
        internal_transfer = self.create(picking_vals)
        for move_val in move_lines:
            pack_lots = move_val['pack_lots']
            del move_val['pack_lots']
            move_val.update({
                'picking_id': internal_transfer.id,
            })
            if len(pack_lots):
                for lot in pack_lots:
                    move_val.update({
                        'qty_done': lot['quantity'],
                        'lot_id': lot['lot_id'],
                        'lot_name': lot['lot_name'],
                    })
                    Move.create(move_val)
            else:
                Move.create(move_val)
        internal_transfer.action_confirm()
        internal_transfer.action_done()
        return internal_transfer.id




