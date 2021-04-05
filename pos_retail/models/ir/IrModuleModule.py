# -*- coding: utf-8 -*-
from odoo import api, models, fields

class IrModuleModule(models.Model):
    _inherit = "ir.module.module"

    # TODO: when users admin do upgrade module, auto remove all call logs databases of POS
    def button_immediate_upgrade(self):
        self.env.cr.execute("delete from ir_model_relation where name='account_tax_sale_order_line_insert_rel'")
        self.env['pos.call.log'].sudo().search([]).unlink()
        self.env['ir.config_parameter'].search([('key', 'in', ['res.partner', 'product.product'])]).unlink()
        self.env.cr.commit()
        res = super(IrModuleModule, self).button_immediate_upgrade()
        return res
