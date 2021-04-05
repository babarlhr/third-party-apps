/*
    This module create by: thanhchatvn@gmail.com
 */
odoo.define('pos_retail.turbo_alive', function (require) {
    var models = require('point_of_sale.models');
    var exports = {};
    var core = require('web.core');
    var _t = core._t;
    var session = require('web.session');
    var rpc = require('web.rpc');
    var load_models_retail = require('pos_retail.load_models');

    var _super_PosModel = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        update_turbo_database: function () {
            console.log('Begin automatic updating Turbo Cache');
            var self = this;
            this.load_server_data_without_loaded().then(function (result) {
                return rpc.query({
                    model: 'pos.cache.config',
                    method: 'update_turbo_database',
                    args: [[], {
                        config_id: self.config_id,
                        json_datas: self.cached,
                    }]
                }, {
                    shadow: true,
                    timeout: 60000
                }).then(function (cache_id) {
                    console.log('Updated turbo cache id : ' + cache_id);
                }, function (err) {
                    console.error(err)
                })
            })
        },
        load_server_data_without_loaded: function () {
            // TODO: this method calling backend with params models but no call loaded function each object
            var self = this;
            var progress = 0;
            var progress_step = 1.0 / self.models.length;
            var tmp = {}; // this is used to share a temporary state between models loaders
            this.cached = {};
            var loaded = new Promise(function (resolve, reject) {
                function load_model(index) {
                    if (index >= self.models.length) {
                        resolve();
                    } else {
                        var model = self.models[index];
                        var cond = typeof model.condition === 'function' ? model.condition(self, tmp) : true;
                        if (!cond) {
                            load_model(index + 1);
                            return;
                        }
                        var fields = typeof model.fields === 'function' ? model.fields(self, tmp) : model.fields;
                        var domain = typeof model.domain === 'function' ? model.domain(self, tmp) : model.domain;
                        var context = typeof model.context === 'function' ? model.context(self, tmp) : model.context || {};
                        var ids = typeof model.ids === 'function' ? model.ids(self, tmp) : model.ids;
                        var order = typeof model.order === 'function' ? model.order(self, tmp) : model.order;
                        progress += progress_step;

                        if (model.model && ['res.partner', 'product.product'].indexOf(model.model) == -1) {
                            var params = {
                                model: model.model,
                                context: _.extend(context, session.user_context || {}),
                            };
                            if (model.ids) {
                                params.method = 'read';
                                params.args = [ids, fields];
                            } else {
                                params.method = 'search_read';
                                params.domain = domain;
                                params.fields = fields;
                                params.orderBy = order;
                            }
                            rpc.query(params, {
                                shadow: true,
                                timeout: 60000
                            }).then(function (result) {
                                var model = self.models[index];
                                if (model.model) {
                                    if (!self.cached[model.model]) {
                                        self.cached[model.model] = [result]
                                    } else {
                                        self.cached[model.model].push(result)
                                    }
                                }
                                load_model(index + 1);
                            }, function (err) {
                                reject(err);
                            });
                        } else {
                            load_model(index + 1);
                        }
                    }
                }
                try {
                    return load_model(0);
                } catch (err) {
                    return Promise.reject(err);
                }
            });
            return loaded;
        },
        load_server_data: function () {
            var self = this;
            return _super_PosModel.load_server_data.apply(this, arguments).then(function () {
                if (self.config.big_datas_turbo) {
                    self.update_turbo_database()
                }
                return true;
            })

        },
    });
    return exports;
});
