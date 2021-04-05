# -*- coding: utf-8 -*-
from odoo import models, fields, api, _

class PosServiceCharge(models.Model):
    _name = "pos.service.charge"
    _description = "Management Service Charge"

    name = fields.Char('Name', required=1)
    product_id = fields.Many2one(
        'product.product',
        string='Service Charge',
        domain=[('available_in_pos', '=', True)],
        required=1
    )
    type = fields.Selection([
        ('percent', 'Percent'),
        ('fixed', 'Fixed')
    ],
        string='Service Charge Type',
        default='percent',
        required=1
    )
    amount = fields.Float(
        'Service Charge Amount Or %',
        required=1
    )