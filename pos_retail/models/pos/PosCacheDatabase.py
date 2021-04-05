# -*- coding: utf-8 -*-
from odoo import api, models, fields, registry
import json
import ast
from odoo.tools import DEFAULT_SERVER_DATETIME_FORMAT
import odoo
version_info = odoo.release.version_info[0]
from datetime import datetime, timedelta

import logging

_logger = logging.getLogger(__name__)

class PosCacheDatabase(models.Model):
    _name = "pos.cache.database"
    _description = "Management POS database"
    _rec_name = "res_id"
    _order = 'res_model'

    res_id = fields.Char('Id')
    res_model = fields.Char('Model')
    deleted = fields.Boolean('Deleted', default=0)

    # TODO: When pos session start each table, pos need call this function for get any modifiers from backend
    def get_modifiers_backend(self, write_date, res_model, config_id=None):
        to_date = datetime.strptime(write_date, DEFAULT_SERVER_DATETIME_FORMAT) + timedelta(
            seconds=1)
        to_date = to_date.strftime(DEFAULT_SERVER_DATETIME_FORMAT)
        records = self.sudo().search([('write_date', '>', to_date), ('res_model', '=', res_model)])
        results = []
        for record in records:
            last_date = record.write_date
            if not record.res_id:
                continue
            value = {
                'model': record.res_model,
                'id': int(record.res_id),
                'write_date': last_date
            }
            if record.deleted:
                value['deleted'] = True
            else:
                val = self.get_data(record.res_model, int(record.res_id), config_id)
                # TODO: method get_data will change write date from write date of record
                #       We change write date back from write date of cache
                if not val:
                    value['deleted'] = True
                else:
                    value.update(val)
                value.update({'write_date': last_date})
            results.append(value)
        return results

    def get_modifiers_backend_all_models(self, model_values, config_id=None):
        results = {}
        for model, write_date in model_values.items():
            values = self.get_modifiers_backend(write_date, model, config_id)
            results[model] = values
        return results

    def get_fields_by_model(self, model_name):
        params = self.env['ir.config_parameter'].sudo().get_param(model_name)
        if not params:
            list_fields = self.env[model_name].sudo().fields_get()
            fields_load = []
            for k, v in list_fields.items():
                if v['type'] not in ['binary']:
                    fields_load.append(k)
            return fields_load
        else:
            params = ast.literal_eval(params)
            return params.get('fields', [])

    def get_domain_by_model(self, model_name):
        params = self.env['ir.config_parameter'].sudo().get_param(model_name)
        if not params:
            return []
        else:
            params = ast.literal_eval(params)
            return params.get('domain', [])

    def install_data(self, model_name=None, min_id=0, max_id=1999):
        _logger.info('Begin install_data of model %s from id %s to id %s' % (model_name, min_id, max_id))
        self.env.cr.execute(
            "select id, call_results from pos_call_log where min_id=%s and max_id=%s and call_model='%s'" % (
                min_id, max_id, model_name))
        old_logs = self.env.cr.fetchall()
        datas = []
        if len(old_logs) == 0:
            datas = self.installing_datas(model_name, min_id, max_id)
        else:
            _logger.info('Datas exist before')
            datas = old_logs[0][1]
        return datas

    def installing_datas(self, model_name, min_id, max_id):
        version_info = odoo.release.version_info[0]
        cache_obj = self.sudo()
        log_obj = self.env['pos.call.log'].sudo()
        domain = [('id', '>=', min_id), ('id', '<=', max_id)]
        if model_name == 'product.product':
            domain.append(('available_in_pos', '=', True))
            domain.append(('sale_ok', '=', True))
        field_list = cache_obj.get_fields_by_model(model_name)
        _logger.info('%s with fields %s' % (model_name, field_list))
        datas = self.env[model_name].sudo().search_read(domain, field_list)
        if version_info in [12, 13]:
            datas = log_obj.covert_datetime(model_name, datas)
        vals = {
            'active': True,
            'min_id': min_id,
            'max_id': max_id,
            'call_fields': json.dumps(field_list),
            'call_results': json.dumps(datas),
            'call_model': model_name,
            'call_domain': json.dumps(domain),
        }
        logs = log_obj.search([
            ('min_id', '=', min_id),
            ('max_id', '=', max_id),
            ('call_model', '=', model_name),
        ])
        if logs:
            logs.write(vals)
        else:
            log_obj.create(vals)
        self.env.cr.commit()
        cache_obj = self.sudo()
        log_obj = self.env['pos.call.log'].sudo()
        domain = [('id', '>=', min_id), ('id', '<=', max_id)]
        if model_name == 'product.product':
            domain.append(('available_in_pos', '=', True))
            domain.append(('sale_ok', '=', True))
        field_list = cache_obj.get_fields_by_model(model_name)
        datas = self.env[model_name].sudo().search_read(domain, field_list)
        version_info = odoo.release.version_info[0]
        if version_info in [12, 13]:
            datas = log_obj.covert_datetime(model_name, datas)
        vals = {
            'active': True,
            'min_id': min_id,
            'max_id': max_id,
            'call_fields': json.dumps(field_list),
            'call_results': json.dumps(datas),
            'call_model': model_name,
            'call_domain': json.dumps(domain),
        }
        logs = log_obj.search([
            ('min_id', '=', min_id),
            ('max_id', '=', max_id),
            ('call_model', '=', model_name),
        ])
        if logs:
            logs.write(vals)
        else:
            log_obj.create(vals)
        self.env.cr.commit()
        return datas

    def reformat_datetime(self, data, model):
        version_info = odoo.release.version_info[0]
        if version_info == 12:
            all_fields = self.env[model].fields_get()
            for field, value in data.items():
                if field == 'model':
                    continue
                try:
                    if all_fields[field] and all_fields[field]['type'] in ['date', 'datetime'] and value:
                        data[field] = value.strftime(DEFAULT_SERVER_DATETIME_FORMAT)
                except:
                    _logger.error('field %s of model %s could not covert to DEFAULT_SERVER_DATETIME_FORMAT' % (field, model))
                    continue
        return data

    @api.model
    def insert_data(self, model, record_id):
        if type(model) == list:
            return False
        last_caches = self.search([('res_id', '=', str(record_id)), ('res_model', '=', model)], limit=1)
        if last_caches:
            last_caches.write({
                'res_model': model,
                'deleted': False
            })
        else:
            self.create({
                'res_id': str(record_id),
                'res_model': model,
                'deleted': False
            })
        return True

    def get_data(self, model, record_id, config_id=None):
        data = {
            'model': model
        }
        fields_sale_load = self.sudo().get_fields_by_model(model)
        vals = {}
        if model == 'pos.order':
            vals = self.env[model].sudo().search_read(
                [
                    ('id', '=', record_id),
                ],
                fields_sale_load)
        if model == 'pos.order.line':
            vals = self.env[model].sudo().search_read(
                [
                    ('id', '=', record_id),
                ],
                fields_sale_load)
        if model not in ['pos.order', 'pos.order.line']:
            vals = self.env[model].sudo().search_read(
                [
                    ('id', '=', record_id),
                ],
                fields_sale_load)
        if vals:
            data.update(vals[0])
            data = self.reformat_datetime(data, model)
            return data
        else:
            return None

    def remove_record(self, model, record_id):
        _logger.info('deleted model %s with id %s' % (model, record_id))
        records = self.sudo().search([('res_id', '=', str(record_id)), ('res_model', '=', model)])
        if records:
            records.write({
                'deleted': True,
            })
        else:
            vals = {
                'res_id': str(record_id),
                'res_model': model,
                'deleted': True,
            }
            self.create(vals)
        return True

    def save_parameter_models_load(self, model_datas):
        for model_name, value in model_datas.items():
            self.env['ir.config_parameter'].sudo().set_param(model_name, value)
        return True
