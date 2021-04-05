# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import UserError
import odoo


class ProductPricelist(models.Model):
    _inherit = "product.pricelist"

    def sync_pricelists_all_pos_online(self):
        version_info = odoo.release.version_info
        if version_info and version_info[0] == 10:
            raise UserError('Sorry, this function not supported odoo version 10')
        else:
            sessions = self.env['pos.session'].sudo().search([
                ('state', '=', 'opened')
            ])
            for session in sessions:
                self.env['bus.bus'].sendmany(
                    [[(self.env.cr.dbname, 'pos.sync.pricelists', session.user_id.id), {}]])
        return True

    def write(self, vals):
        res = super(ProductPricelist, self).write(vals)
        self.sync_pricelists_all_pos_online()
        return res

    def unlink(self):
        for pricelist in self:
            orders = self.env['pos.order'].sudo().search([
                ('pricelist_id', '=', pricelist.id)
            ], limit=1)
            if orders:
                raise UserError('%s Used have save on many POS Orders, not allow remove it' % pricelist.name)
            pos_configs = self.env['pos.config'].sudo().search([
                ('pricelist_id', '=', pricelist.id)
            ], limit=1)
            if pos_configs:
                raise UserError('%s Used have used for POS Config, could not allow remove it' % pricelist.name)
            pos_sessions = self.env['pos.session'].sudo().search([
                ('state', '=', 'opened')
            ], limit=1)
            if pos_sessions:
                raise UserError('Please close all POS session before remove Pricelist')
        return super(ProductPricelist).unlink()