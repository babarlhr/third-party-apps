# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo import models, fields, api, _
from odoo.exceptions import UserError, ValidationError
import logging

_logger = logging.getLogger(__name__)

class AccountPayment(models.Model):

    _inherit = "account.payment"

    pos_branch_id = fields.Many2one('pos.branch', string='Branch')

    @api.model
    def create(self, vals):
        if not vals.get('pos_branch_id'):
            vals.update({'pos_branch_id': self.env['pos.branch'].sudo().get_default_branch()})
        payment = super(AccountPayment, self).create(vals)
        return payment
