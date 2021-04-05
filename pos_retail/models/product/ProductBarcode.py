# -*- coding: utf-8 -*-
from odoo import api, fields, models, _

class ProductBarcode(models.Model):
    _name = 'product.barcode'
    _rec_name = 'barcode'
    _description = "Product multi Barcode"

    product_tmpl_id = fields.Many2one('product.template', 'Product Template', required=1)
    product_id = fields.Many2one('product.product', compute='_get_product_id', string='Product')
    quantity = fields.Float('Quantity', required=1)
    list_price = fields.Float(
        'List Price',
        help='If cashier scan this barcode, this price auto set to line',
        required=1)
    uom_id = fields.Many2one('uom.uom', string='Unit of Measure', required=1)  # v12 only
    barcode = fields.Char('Barcode', required=1)

    def _get_product_id(self):
        for barcode in self:
            products = self.env['product.product'].search([
                ('product_tmpl_id', '=', barcode.product_tmpl_id.id)
            ])
            if products:
                barcode.product_id = products[0].id
            else:
                barcode.product_id = None