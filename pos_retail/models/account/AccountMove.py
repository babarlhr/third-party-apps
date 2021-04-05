# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import RedirectWarning, UserError, ValidationError, AccessError
import logging

_logger = logging.getLogger(__name__)

class AccountMove(models.Model):

    _inherit = "account.move"

    pos_branch_id = fields.Many2one('pos.branch', string='Branch')
    add_credit = fields.Boolean(
        'Add Credit',
        help='If checked, Credit Note Amount total will plus to customer credit card'
    )

    @api.model
    def create(self, vals):
        if not vals.get('pos_branch_id'):
            vals.update({'pos_branch_id': self.env['pos.branch'].sudo().get_default_branch()})
        if not vals.get('company_id', None):
            vals.update({'company_id': self.env.user.company_id.id})
        move = super(AccountMove, self).create(vals)
        self.env['pos.cache.database'].insert_data(self._inherit, move.id)
        for move_line in move.line_ids:
            self.env['pos.cache.database'].insert_data('account.move.line', move_line.id)
        return move

    def write(self, vals):
        credit_object = self.env['res.partner.credit']
        for invoice in self:
            if invoice.add_credit and vals.get('state', None) == 'posted':
                credit = credit_object.create({
                    'name': invoice.name,
                    'type': 'plus',
                    'amount': invoice.amount_total,
                    'move_id': invoice.id,
                    'partner_id': invoice.partner_id.id,
                })
                self.env['pos.cache.database'].insert_data('res.partner', credit.partner_id.id)
            if vals.get('state', None) in ['draft', 'cancel']:
                credit_object.search([('move_id', '=', invoice.id)]).write({'active': False})
        res = super(AccountMove, self).write(vals)
        for move in self:
            self.env['pos.cache.database'].insert_data(self._inherit, move.id)
        return res

    def unlink(self):
        for move in self:
            self.env['pos.cache.database'].remove_record(self._inherit, move.id)
        return super(AccountMove, self).unlink()

class AccountMoveLine(models.Model):
    _inherit = "account.move.line"

    pos_branch_id = fields.Many2one(
        'pos.branch',
        string='Branch',
        related='move_id.pos_branch_id',
        store=True,
        readonly=1
    )

    # TODO: why could not call create ??? If we remove comments here, pos session could not closing
    # TODO: dont reopen-comments codes
    # @api.model
    # def create(self, vals):
    #     if not vals.get('pos_branch_id'):
    #         vals.update({'pos_branch_id': self.env['pos.branch'].sudo().get_default_branch()})
    #     move_line = super(AccountMoveLine, self).create(vals)
    #     return move_line

    def write(self, vals):
        res = super(AccountMoveLine, self).write(vals)
        for move_line in self:
            self.env['pos.cache.database'].insert_data(self._inherit, move_line.id)
        return res

    def unlink(self):
        for move_line in self:
            self.env['pos.cache.database'].remove_record(self._inherit, move_line.id)
        return super(AccountMoveLine, self).unlink()

