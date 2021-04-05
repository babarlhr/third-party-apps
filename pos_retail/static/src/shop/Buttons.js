odoo.define('pos_retail.buttons', function (require) {
    var screens = require('point_of_sale.screens');
    var core = require('web.core');
    var _t = core._t;
    var qweb = core.qweb;
    var WebClient = require('web.AbstractWebClient');

    var button_reload_pos = screens.ActionButtonWidget.extend({ // combo button
        template: 'button_reload_pos',
        button_click: function () {
            return this.pos.reload_pos();
        }
    });

    screens.define_action_button({
        'name': 'button_reload_pos',
        'widget': button_reload_pos,
        'condition': function () {
            return true;
        }
    });

    var ButtonNoteOrder = screens.ActionButtonWidget.extend({ // combo button
        template: 'ButtonNoteOrder',
        button_click: function () {
            var order = this.pos.get_order();
            if (order) {
                var self = this;
                this.pos.gui.show_popup('textarea', {
                    title: _t('Add Order Note'),
                    value: order.get_note(),
                    confirm: function (note) {
                        order.set_note(note);
                        return self.pos.gui.show_popup('dialog', {
                            title: _t('Succeed'),
                            body: _t('You set note to order: ' + note),
                            color: 'success'
                        })
                    },
                });
            }
        }
    });

    screens.define_action_button({
        'name': 'ButtonNoteOrder',
        'widget': ButtonNoteOrder,
        'condition': function () {
            return this.pos.config.note_order;
        }
    });


    var button_discount_sale_price = screens.ActionButtonWidget.extend({
        template: 'button_discount_sale_price',
        button_click: function () {
            var self = this;
            var order = this.pos.get_order();
            if (!order) {
                return
            }
            var selected_line = order.get_selected_orderline();
            if (!selected_line) {
                return
            }
            var amount_with_tax = selected_line.get_price_with_tax();
            this.gui.show_popup('number', {
                'title': _t('Which value of discount would you apply ?'),
                'value': self.pos.config.discount_sale_price_limit,
                'confirm': function (discount_value) {
                    discount_value = parseFloat(discount_value);
                    if (amount_with_tax < discount_value) {
                        return self.pos.gui.show_popup('dialog', {
                            title: 'Warning',
                            body: _t('We could not set amount bigger than amount of line')
                        })
                    } else {
                        if (discount_value > self.pos.config.discount_sale_price_limit) {
                            if (self.pos.config.discount_unlock_by_manager) {
                                var manager_validate = [];
                                _.each(self.pos.config.manager_ids, function (user_id) {
                                    var user = self.pos.user_by_id[user_id];
                                    if (user) {
                                        manager_validate.push({
                                            label: user.name,
                                            item: user
                                        })
                                    }
                                });
                                if (manager_validate.length == 0) {
                                    return self.pos.gui.show_popup('confirm', {
                                        title: 'Warning',
                                        body: _t('Could not set discount bigger than: ' + self.pos.gui.chrome.format_currency(discount_value) + ' . If is required, need manager approve but your pos not set manager users approve on Security Tab'),
                                    })
                                }
                                return self.pos.gui.show_popup('selection', {
                                    title: 'Choice Manager Validate',
                                    body: _t('Only Manager can approve this Discount, please ask him'),
                                    list: manager_validate,
                                    confirm: function (manager_user) {
                                        if (!manager_user.pos_security_pin) {
                                            return self.pos.gui.show_popup('confirm', {
                                                title: 'Warning',
                                                body: _t(user.name + ' have not set pos security pin before. Please set pos security pin first')
                                            })
                                        } else {
                                            return self.pos.gui.show_popup('ask_password', {
                                                title: 'Pos Security Pin of Manager',
                                                body: _t('Your staff need approve discount value is ' + self.pos.gui.chrome.format_currency(discount_value) + ', please approve'),
                                                confirm: function (password) {
                                                    if (manager_user['pos_security_pin'] != password) {
                                                        self.pos.gui.show_popup('dialog', {
                                                            title: 'Error',
                                                            body: _t('POS Security pin of ' + manager_user.name + ' not correct !')
                                                        });
                                                    } else {
                                                        var taxes_ids = selected_line.product.taxes_id;
                                                        var taxes = self.pos.taxes;
                                                        _(taxes_ids).each(function (id) {
                                                            var tax = _.detect(taxes, function (t) {
                                                                return t.id === id;
                                                            });
                                                            if (tax) {
                                                                selected_line.set_discount_price(discount_value, tax)
                                                            }

                                                        });
                                                        if (taxes_ids.length == 0) {
                                                            selected_line.set_unit_price(selected_line.price - discount_value);
                                                            selected_line.trigger('change', selected_line);
                                                        }
                                                    }
                                                }
                                            });
                                        }
                                    }
                                })
                            } else {
                                return self.gui.show_popup('dialog', {
                                    title: _t('Warning'),
                                    body: _t('You can not set discount bigger than ' + self.pos.config.discount_limit_amount + '. Please contact your pos manager and set bigger than'),
                                })
                            }
                        } else {
                            var taxes_ids = selected_line.product.taxes_id;
                            var taxes = self.pos.taxes;
                            _(taxes_ids).each(function (id) {
                                var tax = _.detect(taxes, function (t) {
                                    return t.id === id;
                                });
                                if (tax)
                                    selected_line.set_discount_price(discount_value, tax)
                            });
                            if (taxes_ids.length == 0) {
                                selected_line.set_unit_price(selected_line.price - discount_value);
                                selected_line.trigger('change', selected_line);
                            }
                        }
                    }
                }
            })


        }
    });

    screens.define_action_button({
        'name': 'button_discount_sale_price',
        'widget': button_discount_sale_price,
        'condition': function () {
            return this.pos.config.discount_sale_price && this.pos.config.discount_sale_price_limit > 0;
        }
    });

    var button_set_seller = screens.ActionButtonWidget.extend({ // combo button
        template: 'button_set_seller',
        button_click: function () {
            var self = this;
            var sellers = this.pos.sellers;
            return this.pos.gui.show_popup('popup_selection_extend', {
                title: 'Select Sale Person',
                fields: ['name', 'email', 'id'],
                sub_datas: sellers,
                sub_template: 'sale_persons',
                body: _t('Please select one sale person'),
                confirm: function (user_id) {
                    var seller = self.pos.user_by_id[user_id];
                    var order = self.pos.get_order();
                    var selected_line = order.get_selected_orderline();
                    if (selected_line) {
                        selected_line.set_sale_person(seller)
                    } else {
                        self.pos.gui.show_popup('dialog', {
                            title: 'Warning',
                            body: _t('Please select line first')
                        })
                    }

                }
            })
        }
    });

    // screens.define_action_button({
    //     'name': 'button_set_seller',
    //     'widget': button_set_seller,
    //     'condition': function () {
    //         return this.pos.config.add_sale_person && this.pos.sellers && this.pos.sellers.length >= 1;
    //     }
    // });

    var button_combo_item_add_lot = screens.ActionButtonWidget.extend({ // add lot to combo items
        template: 'button_combo_item_add_lot',

        button_click: function () {
            var selected_orderline = this.pos.get_order().selected_orderline;
            if (!selected_orderline) {
                this.gui.show_popup('dialog', {
                    title: 'Error',
                    from: 'top',
                    align: 'center',
                    body: _t('Please selected line before add lot'),
                    color: 'danger',
                    timer: 2000
                });
                return;
            } else {
                this.pos.gui.show_popup('popup_add_lot_to_combo_items', {
                    'title': _t('Lot/Serial Number(s) Combo Items'),
                    'combo_items': selected_orderline['combo_items'],
                    'orderline': selected_orderline,
                    'widget': this,
                });
            }
        }
    });

    screens.define_action_button({
        'name': 'button_combo_item_add_lot',
        'widget': button_combo_item_add_lot,
        'condition': function () {
            return this.pos.combo_items && this.pos.combo_items.length > 0;
        }
    });


    var button_create_internal_transfer = screens.ActionButtonWidget.extend({  // internal transfer
        template: 'button_create_internal_transfer',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            var order = this.pos.get_order();
            var length = order.orderlines.length;
            if (length == 0) {
                return this.gui.show_popup('dialog', {
                    title: 'Error',
                    body: 'Your order lines is blank',
                });
            } else {
                this.pos.gui.show_popup('popup_internal_transfer', {
                    title: _t('Transfer Between Stock'),
                })
            }
        }
    });

    screens.define_action_button({
        'name': 'button_create_internal_transfer',
        'widget': button_create_internal_transfer,
        'condition': function () {
            return this.pos.config.internal_transfer;
        }
    });

    var button_create_purchase_order = screens.ActionButtonWidget.extend({
        template: 'button_create_purchase_order',
        button_click: function () {
            this.gui.show_popup('popup_create_purchase_order', {
                title: _t('Create Purchase Order'),
                widget: this,
            });
        }
    });

    screens.define_action_button({
        'name': 'button_create_purchase_order',
        'widget': button_create_purchase_order,
        'condition': function () {
            return this.pos.config.create_purchase_order;
        }
    });

    var button_register_payment = screens.ActionButtonWidget.extend({
        template: 'button_register_payment',
        button_click: function () {
            this.chrome.do_action('account.action_account_payment_from_invoices', {
                additional_context: {
                    active_ids: [3]
                }
            });
        }
    });

    screens.define_action_button({
        'name': 'button_register_payment',
        'widget': button_register_payment,
        'condition': function () {
            return false;
        }
    });

    // TODO: hide button because display on dock
    // screens.define_action_button({
    //     'name': 'button_signature_order',
    //     'widget': button_signature_order,
    //     'condition': function () {
    //         return this.pos.config.signature_order;
    //     }
    // });

    var button_print_user_card = screens.ActionButtonWidget.extend({
        template: 'button_print_user_card',
        button_click: function () {
            var cashier = this.pos.get_cashier();
            var user_id = cashier.user_id;
            if (user_id) {
                var user = this.pos.user_by_id[user_id[0]]
                cashier.image = 'data:image/png;base64,' + user.image_1920
            }
            var UserCardHtml = qweb.render('UserCardHtml', {
                cashier: cashier,
                company: this.pos.company,
                pos: this.pos
            });
            this.pos.report_html = UserCardHtml;
            this.gui.show_screen('report');

        }
    });

    screens.define_action_button({
        'name': 'button_print_user_card',
        'widget': button_print_user_card,
        'condition': function () {
            return this.pos.config.print_user_card == true;
        }
    });

    var button_clear_order = screens.ActionButtonWidget.extend({
        template: 'button_clear_order',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            var orders = this.pos.get('orders');
            for (var i = 0; i < orders.models.length; i++) {
                var order = orders.models[i];
                if (order.orderlines.models.length == 0) {
                    order.destroy({'reason': 'abandon'});
                }
            }
        }
    });
    screens.define_action_button({
        'name': 'button_clear_order',
        'widget': button_clear_order,
        'condition': function () {
            return false; // hide
        }
    });

    var button_restart_session = screens.ActionButtonWidget.extend({
        template: 'button_restart_session',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            var def = new $.Deferred();
            var list = [];
            var self = this;
            for (var i = 0; i < this.pos.configs.length; i++) {
                var config = this.pos.configs[i];
                if (config.id != this.pos.config['id']) {
                    list.push({
                        'label': config.name,
                        'item': config
                    });
                }
            }
            if (list.length > 0) {
                this.gui.show_popup('selection', {
                    title: _t('Switch to user'),
                    list: list,
                    confirm: function (config) {
                        def.resolve(config);
                    }
                });
            } else {
                return this.pos.gui.show_popup('dialog', {
                    title: 'Warning',
                    body: 'Your system have only one config'
                });
            }
            return def.then(function (config) {
                var user = self.pos.user_by_id[config.user_id[0]];
                if (!user || (user && !user.pos_security_pin)) {
                    var web_client = new WebClient();
                    web_client._title_changed = function () {
                    };
                    web_client.show_application = function () {
                        return web_client.action_manager.do_action("pos.ui");
                    };
                    $(function () {
                        web_client.setElement($(document.body));
                        web_client.start();
                    });
                    return web_client;
                }
                if (user && user.pos_security_pin) {
                    return self.pos.gui.ask_password(user.pos_security_pin).then(function () {
                        var web_client = new WebClient();
                        web_client._title_changed = function () {
                        };
                        web_client.show_application = function () {
                            return web_client.action_manager.do_action("pos.ui");
                        };
                        $(function () {
                            web_client.setElement($(document.body));
                            web_client.start();
                        });
                        return web_client;
                    });
                }
            });
        }
    });
    screens.define_action_button({
        'name': 'button_restart_session',
        'widget': button_restart_session,
        'condition': function () {
            return this.pos.config.switch_user;
        }
    });

    var button_print_last_order = screens.ActionButtonWidget.extend({
        template: 'button_print_last_order',
        init: function (parent, options) {
            this._super(parent, options);
            this.pos.bind('print:last_receipt', function () {
                this.button_click()
            }, this);
        },
        button_click: function () {
            if (this.pos.report_html) {
                this.pos.gui.show_screen('report');
            } else {
                this.gui.show_popup('dialog', {
                    'title': _t('Error'),
                    'body': _t('Could not find last order'),
                });
            }
        },
    });

    screens.define_action_button({
        'name': 'button_print_last_order',
        'widget': button_print_last_order,
        'condition': function () {
            return this.pos.config.print_last_order;
        },
    });

    var button_medical_insurance_screen = screens.ActionButtonWidget.extend({
        template: 'button_medical_insurance_screen',
        button_click: function () {
            return this.pos.gui.show_screen('medical_insurance_screen')
        },
        init: function (parent, options) {
            this._super(parent, options);
            this.pos.bind('change:medical_insurance', function () {
                this.renderElement();
                var order = this.pos.get_order();
                order.trigger('change', order);
            }, this);
        },
    });

    screens.define_action_button({
        'name': 'button_medical_insurance_screen',
        'widget': button_medical_insurance_screen,
        'condition': function () {
            return this.pos.config.medical_insurance;
        },
    });

    var button_set_guest = screens.ActionButtonWidget.extend({
        template: 'button_set_guest',
        button_click: function () {
            return this.pos.gui.show_popup('popup_set_guest', {
                title: _t('Add guest'),
                confirm: function (values) {
                    if (!values['guest'] || !values['guest']) {
                        return this.pos.gui.show_popup('dialog', {
                            title: 'Error',
                            body: 'Field guest name and guest number is required'
                        })
                    } else {
                        var order = this.pos.get_order();
                        if (order) {
                            order['guest'] = values['guest'];
                            order['guest_number'] = values['guest_number'];
                            order.trigger('change', order);
                            this.pos.trigger('change:guest');
                        }
                    }
                }
            });
        },
        init: function (parent, options) {
            var self = this;
            this._super(parent, options);
            this.pos.bind('change:guest', function () {
                this.renderElement();
                var order = this.pos.get_order();
                order.trigger('change', order);
            }, this);
            if (this.pos.config.set_guest_when_add_new_order) {
                this.pos.get('orders').bind('add', function (order) {
                    if (!order.is_return) {
                        setTimeout(function () {
                            self.button_click()
                        }, 1000);
                    }
                }, this);
            }
        },
    });

    screens.define_action_button({
        'name': 'button_set_guest',
        'widget': button_set_guest,
        'condition': function () {
            return this.pos.config.set_guest;
        },
    });

    var button_reset_sequence = screens.ActionButtonWidget.extend({
        template: 'button_reset_sequence',
        button_click: function () {
            this.pos.pos_session.sequence_number = 0;
            return this.pos.gui.show_popup('dialog', {
                title: 'Done',
                body: 'You just set sequence number to 0',
                color: 'success'
            })
        },
        init: function (parent, options) {
            this._super(parent, options);
            this.pos.bind('change:guest', function () {
                this.renderElement();
                var order = this.pos.get_order();
                order.trigger('change', order);
            }, this);
        },
    });

    screens.define_action_button({
        'name': 'button_reset_sequence',
        'widget': button_reset_sequence,
        'condition': function () {
            return this.pos.config.reset_sequence;
        },
    });

    var button_change_tax = screens.ActionButtonWidget.extend({
        template: 'button_change_tax',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            var self = this;
            var order = this.pos.get_order();
            var taxes = [];
            var update_tax_ids = this.pos.config.update_tax_ids || [];
            for (var i = 0; i < this.pos.taxes.length; i++) {
                var tax = this.pos.taxes[i];
                if (update_tax_ids.indexOf(tax.id) != -1) {
                    taxes.push(tax)
                }
            }
            if (order.get_selected_orderline() && taxes.length) {
                var line_selected = order.get_selected_orderline();
                return this.gui.show_popup('popup_select_tax', {
                    title: 'Please choose tax',
                    line_selected: line_selected,
                    taxes: taxes,
                    confirm: function () {
                        return self.pos.gui.close_popup();
                    },
                    cancel: function () {
                        return self.pos.gui.close_popup();
                    }
                });
            } else {
                return this.gui.show_popup('dialog', {
                    title: _t('Warning'),
                    body: ('Please select line before add taxes or update taxes on pos config not setting')
                });
            }
        }
    });

    screens.define_action_button({
        'name': 'button_change_tax',
        'widget': button_change_tax,
        'condition': function () {
            return this.pos.config && this.pos.config.update_tax;
        }
    });

    var button_turn_onoff_printer = screens.ActionButtonWidget.extend({
        template: 'button_turn_onoff_printer',
        button_click: function () {
            if (this.pos.proxy.printer && this.pos.proxy.print_receipt) {
                this.pos.gui.show_popup('dialog', {
                    title: 'Turn on',
                    body: 'Your printer ready for print any orders receipt',
                    color: 'success'
                })
            } else {
                this.pos.gui.show_popup('dialog', {
                    title: 'Turn off',
                    body: 'Your printer turn off, orders receipt will print via web browse'
                })
            }
            this.pos.proxy.printer = !this.pos.proxy.printer;
            this.pos.trigger('onoff:printer');
        },
        init: function (parent, options) {
            this._super(parent, options);
            this.pos.bind('onoff:printer', function () {
                this.renderElement();
                var order = this.pos.get_order();
                order.trigger('change', order);
            }, this);
        }
    });

    screens.define_action_button({
        'name': 'button_turn_onoff_printer',
        'widget': button_turn_onoff_printer,
        'condition': function () {
            return this.pos.config.printer_on_off;
        }
    });
});
