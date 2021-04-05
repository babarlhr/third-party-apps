"use strict";
/*
    This module create by: thanhchatvn@gmail.com
    License: OPL-1
    Please do not modification if i not accept
    Thanks for understand
 */
odoo.define('pos_retail.order', function (require) {

    var models = require('point_of_sale.models');
    var core = require('web.core');
    var _t = core._t;
    var MultiUnitWidget = require('pos_retail.multi_unit');
    var PosRetailProductScreenList = require('pos_retail.screen_product_list');
    var rpc = require('pos.rpc');

    var _super_PosModel = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        initialize: function (session, attributes) {
            _super_PosModel.initialize.apply(this, arguments);
            this.bind('change:selectedOrder', function (pos) {
                var order = pos.get_order();
                if (order) {
                    order.add_barcode('barcode'); // TODO: add barcode to html page
                }
            });
        }
    });

    var _super_Order = models.Order.prototype;
    models.Order = models.Order.extend({
        // Solution for duplicate uid
        // get_unique_number: function () {
        //     return Date.now().toString(36) + Math.random().toString(36).substr(2);
        // },
        // generate_unique_id: function () {
        //     var unique_string = _super_Order.generate_unique_id.apply(this, arguments);
        //     unique_string += '-' + this.get_unique_number();
        //     console.log('new order uid: ' + unique_string);
        //     return unique_string
        // },
        initialize: function (attributes, options) {
            _super_Order.initialize.apply(this, arguments);
            if (!this.note) {
                this.note = '';
            }
            if (!this.signature) {
                this.signature = '';
            }
            if (!this.lock) {
                this.lock = false;
            }
            if (this.pos.config.pos_auto_invoice) {
                this.to_invoice = true;
            }
            if (!this.seller && this.pos.default_seller) {
                this.seller = this.pos.default_seller;
            }
            if (!this.seller && this.pos.config.default_seller_id) {
                var seller = this.pos.user_by_id[this.pos.config.default_seller_id[1]];
                if (seller) {
                    this.seller = seller;
                }
            }
            if (!options.json) {
                if (this.pos.config.analytic_account_id) {
                    this.analytic_account_id = this.pos.config.analytic_account_id[0]
                }
                this.currency_id = this.pos.config.currency_id[0];
            }

        },
        save_to_db: function () {
            _super_Order.save_to_db.apply(this, arguments);
            var selected_line = this.get_selected_orderline();
            if (selected_line) {
                this.pos.trigger('selected:line', selected_line)
            }
        },
        init_from_JSON: function (json) {
            // TODO: we removed line have product removed
            var lines = json.lines;
            var lines_without_product_removed = [];
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                var product_id = line[2]['product_id'];
                var product = this.pos.db.get_product_by_id(product_id);
                if (product) {
                    lines_without_product_removed.push(line)
                }
            }
            json.lines = lines_without_product_removed;
            // ---------------------------------
            var res = _super_Order.init_from_JSON.apply(this, arguments);
            if (json.date) {
                this.date = json.date;
            }
            if (json.name) {
                this.name = json.name;
            }
            if (json.email_invoice) {
                this.email_invoice = json.email_invoice;
            }
            if (json.email_invoice) {
                this.email_invoice = json.email_invoice;
            }
            if (json.delivery_date) {
                this.delivery_date = json.delivery_date;
            }
            if (json.delivery_address) {
                this.delivery_address = json.delivery_address;
            }
            if (json.delivery_phone) {
                this.delivery_phone = json.delivery_phone;
            }
            if (json.amount_debit) {
                this.amount_debit = json.amount_debit;
            }
            if (json.return_order_id) {
                this.return_order_id = json.return_order_id;
            }
            if (json.is_return) {
                this.is_return = json.is_return;
            }
            if (json.to_invoice) {
                this.to_invoice = json.to_invoice;
            }
            if (json.parent_id) {
                this.parent_id = json.parent_id;
            }
            if (json.sale_journal) {
                this.sale_journal = json.sale_journal;
            } else {
                this.sale_journal = this.pos.get_default_sale_journal();
            }
            if (json.ean13) {
                this.ean13 = json.ean13;
            }
            if (json.signature) {
                this.signature = json.signature
            }
            if (json.note) {
                this.note = json.note
            }
            if (json.lock) {
                this.lock = json.lock;
            } else {
                this.lock = false;
            }
            if (json.medical_insurance_id) {
                this.medical_insurance = this.pos.db.insurance_by_id[json.medical_insurance_id];
            }
            if (json.guest) {
                this.guest = json.guest;
            }
            if (json.guest_number) {
                this.guest_number = json.guest_number;
            }
            if (json.location_id) {
                var location = this.pos.stock_location_by_id[json.location_id];
                if (location) {
                    this.set_picking_source_location(location)
                } else {
                    var location = this.get_picking_source_location();
                    this.set_picking_source_location(location)
                }
            } else {
                var location = this.get_picking_source_location();
                if (location) {
                    this.set_picking_source_location(location);
                }
            }
            if (json.add_credit) {
                this.add_credit = json.add_credit
            } else {
                this.add_credit = false;
            }
            if (json.user_id) {
                this.seller = this.pos.user_by_id[json.user_id];
            }
            if (json.currency_id) {
                var currency = this.pos.currency_by_id[json.currency_id];
                this.currency = currency;
            }
            if (json.analytic_account_id) {
                this.analytic_account_id = json.analytic_account_id
            }
            if (json.shipping_id) {
                var shipping_client = this.pos.db.get_partner_by_id(json.shipping_id);
                if (!shipping_client) {
                    console.error('ERROR: trying to load a partner not available in the pos');
                } else {
                    this.set_shipping_client(shipping_client);
                }
            }
            if (json.employee_id) {
                // todo: default module point_of_sale core odoo define variable employee_id linked to cashier but backend not define employee_id
                // todo: my module have define employee_id, and when force cashier id to employee will have issue
                // todo: so we recheck have employee with cashier id or not, if yes, allow save, else set back null
                if (this.pos.employee_by_id) {
                    var employee = this.pos.employee_by_id[json.employee_id]
                    if (!employee) {
                        this.employee_id = null
                    }
                } else {
                    this.employee_id = null
                }

            }
            return res;
        },
        export_as_JSON: function () {
            var json = _super_Order.export_as_JSON.apply(this, arguments);
            if (this.seller) {
                json.user_id = this.seller['id'];
            }
            if (this.partial_payment) {
                json.partial_payment = this.partial_payment
            }
            if (this.email_invoice) {
                json.email_invoice = this.email_invoice;
                var client = this.get_client();
                if (client && client.email) {
                    json.email = client.email;
                }
            }
            if (this.delivery_date) {
                json.delivery_date = this.delivery_date;
            }
            if (this.delivery_address) {
                json.delivery_address = this.delivery_address;
            }
            if (this.delivery_phone) {
                json.delivery_phone = this.delivery_phone;
            }
            if (this.amount_debit) {
                json.amount_debit = this.amount_debit;
            }
            if (this.return_order_id) {
                json.return_order_id = this.return_order_id;
            }
            if (this.is_return) {
                json.is_return = this.is_return;
            }
            if (this.parent_id) {
                json.parent_id = this.parent_id;
            }
            if (this.sale_journal) {
                json.sale_journal = this.sale_journal;
            } else {
                this.sale_journal = this.pos.get_default_sale_journal();
            }
            if (this.note) {
                json.note = this.note;
            }
            if (this.signature) {
                json.signature = this.signature;
            }
            if (this.ean13) {
                json.ean13 = this.ean13;
                this.add_barcode('barcode')
            }
            if (!this.ean13 && this.uid) {
                var ean13_code = this.zero_pad(this.pos.user.id, 4) + this.zero_pad(this.pos.pos_session.login_number, 4) + this.zero_pad(this.sequence_number, 4);
                var ean13 = ean13_code.split("");
                var ean13_array = [];
                for (var i = 0; i < ean13.length; i++) {
                    if (i < 12) {
                        ean13_array.push(ean13[i])
                    }
                }
                this.ean13 = ean13_code + this.generate_unique_ean13(ean13_array).toString();
                this.add_barcode('barcode')
            }
            if (this.lock) {
                json.lock = this.lock;
            } else {
                json.lock = false;
            }
            if (this.invoice_ref) {
                json.invoice_ref = this.invoice_ref
            }
            if (this.picking_ref) {
                json.picking_ref = this.picking_ref
            }
            if (this.medical_insurance) {
                json.medical_insurance_id = this.medical_insurance.id
            }
            if (this.guest) {
                json.guest = this.guest.id
            }
            if (this.guest_number) {
                json.guest_number = this.guest_number.id
            }
            if (this.add_credit) {
                json.add_credit = this.add_credit
            } else {
                json.add_credit = false
            }
            if (this.location_id) {
                var stock_location_id = this.pos.config.stock_location_id;
                if (stock_location_id) {
                    var location = this.pos.stock_location_by_id[this.location_id];
                    if (location) {
                        json.location = location;
                        json.location_id = location.id;
                    }
                }
            }
            if (this.currency) {
                json.currency_id = this.currency.id
            }
            if (this.analytic_account_id) {
                json.analytic_account_id = this.analytic_account_id
            }
            if (this.shipping_client) {
                json.shipping_id = this.shipping_client.id;
            }
            if (json.employee_id) {
                // todo: default module point_of_sale core odoo define variable employee_id linked to cashier but backend not define employee_id
                // todo: my module have define employee_id, and when force cashier id to employee will have issue
                // todo: so we recheck have employee with cashier id or not, if yes, allow save, else set back null
                if (this.pos.employee_by_id) {
                    var employee = this.pos.employee_by_id[json.employee_id]
                    if (!employee) {
                        json.employee_id = null;
                        this.employee_id = null;
                    }
                } else {
                    json.employee_id = null;
                    this.employee_id = null;
                }

            }
            return json;
        },
        export_for_printing: function () {
            var receipt = _super_Order.export_for_printing.call(this);
            var order = this.pos.get_order();
            if (this.seller) {
                receipt['seller'] = this.seller;
            }
            if (this.location) {
                receipt['location'] = this.location;
            } else {
                var stock_location_id = this.pos.config.stock_location_id;
                if (stock_location_id) {
                    receipt['location'] = this.pos.stock_location_by_id[stock_location_id[0]];
                }
            }
            receipt['currency'] = order.currency;
            receipt['guest'] = this.guest;
            receipt['guest_number'] = this.guest_number;
            receipt['medical_insurance'] = null;
            receipt['delivery_date'] = this.delivery_date;
            receipt['delivery_address'] = this.delivery_address;
            receipt['delivery_phone'] = this.delivery_phone;
            receipt['note'] = this.note;
            receipt['signature'] = this.signature;
            if (this.shipping_client) {
                receipt['shipping_client'] = this.shipping_client;
            }
            if (this.fiscal_position) {
                receipt.fiscal_position = this.fiscal_position
            }
            if (this.amount_debit) {
                receipt['amount_debit'] = this.amount_debit;
            }
            if (this.medical_insurance) {
                receipt['medical_insurance'] = this.medical_insurance;
            }
            var orderlines_by_category_name = {};
            var orderlines = order.orderlines.models;
            var categories = [];
            receipt['categories'] = [];
            receipt['orderlines_by_category_name'] = [];
            if (this.pos.config.category_wise_receipt) {
                for (var i = 0; i < orderlines.length; i++) {
                    var line = orderlines[i];
                    var pos_categ_id = line['product']['pos_categ_id']
                    line['tax_amount'] = line.get_tax();
                    if (pos_categ_id && pos_categ_id.length == 2) {
                        var root_category_id = order.get_root_category_by_category_id(pos_categ_id[0])
                        var category = this.pos.db.category_by_id[root_category_id]
                        var category_name = category['name'];
                        if (!orderlines_by_category_name[category_name]) {
                            orderlines_by_category_name[category_name] = [line];
                            var category_index = _.findIndex(categories, function (category) {
                                return category == category_name;
                            });
                            if (category_index == -1) {
                                categories.push(category_name)
                            }
                        } else {
                            orderlines_by_category_name[category_name].push(line)
                        }

                    } else {
                        if (!orderlines_by_category_name['None']) {
                            orderlines_by_category_name['None'] = [line]
                        } else {
                            orderlines_by_category_name['None'].push(line)
                        }
                        var category_index = _.findIndex(categories, function (category) {
                            return category == 'None';
                        });
                        if (category_index == -1) {
                            categories.push('None')
                        }
                    }
                }
                receipt['orderlines_by_category_name'] = orderlines_by_category_name;
                receipt['categories'] = categories;
            }
            receipt['total_due'] = order.get_due(); // save amount due if have (display on receipt of parital order)
            return receipt
        },
        set_pricelist: function (pricelist) {
            var res = _super_Order.set_pricelist.apply(this, arguments);
            if (this.pos.gui.screen_instances['products']) {
                this.pos.auto_update_stock_products(this.pos.gui.screen_instances['products'].product_list_widget.product_list);
            }
            return res;
        },
        set_picking_source_location: function (location) {
            this.location = location;
            this.location_id = location.id;
            this.pos.config.stock_location_id = [location.id, location.name];
            this.trigger('change', this);
        },
        get_picking_source_location: function () {
            var stock_location_id = this.pos.config.stock_location_id;
            if (this.location) {
                return this.location;
            } else {
                return this.pos.stock_location_by_id[stock_location_id[0]];
            }
        },
        remove_selected_orderline: function () {
            var line = this.get_selected_orderline();
            if (line) {
                this.remove_orderline(line)
            }
        },
        set_currency: function (currency) {
            var rate = currency.rate;
            if (rate > 0) {
                var lines = this.orderlines.models;
                for (var n = 0; n < lines.length; n++) {
                    var line = lines[n];
                    line.set_unit_price_with_currency(line.price, currency)
                }
                this.currency = currency;
                this.pos.trigger('change:currency'); // TODO: update ticket and order cart
            } else {
                this.currency = null;
            }
            this.trigger('change', this);
        },
        add_barcode: function (element) {
            if (!this.element) {
                JsBarcode('#' + element, this['ean13'], {
                    format: "EAN13",
                    displayValue: true,
                    fontSize: 14
                });
                this[element + '_bas64'] = document.getElementById(element).src
            }
        },
        zero_pad: function (num, size) {
            var s = "" + num;
            while (s.length < size) {
                s = s + Math.floor(Math.random() * 10).toString();
            }
            return s;
        },
        show_popup_multi_lot: function () {
            var self = this;
            var lots = this.pos.lot_by_product_id[this.selected_orderline.product.id];
            if (!lots) {
                return this.pos.gui.show_popup('confirm', {
                    title: _t('Warning'),
                    body: this.selected_orderline.product.display_name + _t(' have not any lots created before')
                })
            }
            this.pos.gui.show_popup('popup_set_multi_lots', {
                'title': _t('Set lots for Product:  ' + this.selected_orderline.product.display_name),
                'body': _t('Allow you set multi lot  ' + this.selected_orderline.product.display_name + _t(', please made sure total quantities of lots the same of quantity of ') + this.selected_orderline.product.display_name + ' in cart.'),
                'selected_orderline': this.selected_orderline,
                'lots': this.pos.lot_by_product_id[this.selected_orderline.product.id],
                confirm: function (lot_ids) {
                    var selected_orderline = self.selected_orderline;
                    selected_orderline.set_multi_lot(lot_ids);
                }
            })
        },
        display_lot_popup: function () {
            if (!this.pos.config.multi_lots) {
                return _super_Order.display_lot_popup.apply(this, arguments);
            } else {
                return this.show_popup_multi_lot();
            }
        },
        get_medical_insurance: function () {
            if (this.medical_insurance) {
                return this.medical_insurance
            } else {
                return null
            }
        },
        get_guest: function () {
            if (this.guest) {
                return this.guest
            } else {
                return null
            }
        },
        _get_client_content: function (client) {
            var content = '';
            if (client.mobile) {
                content += 'Mobile: ' + client.mobile + ' , ';
            }
            if (client.phone) {
                content += 'Mobile: ' + client.phone + ' , ';
            }
            if (client.email) {
                content += 'Email: ' + client.email + ' , ';
            }
            if (client.address) {
                content += 'Address: ' + client.address + ' , ';
            }
            if (client.balance) {
                content += 'Credit: ' + this.pos.gui.chrome.format_currency(client.balance) + ' , ';
            }
            if (client.wallet) {
                content += 'Wallet Card: ' + this.pos.gui.chrome.format_currency(client.wallet) + ' , ';
            }
            if (client.pos_loyalty_point) {
                content += 'Loyalty Point: ' + this.pos.gui.chrome.format_currency_no_symbol(client.pos_loyalty_point) + ' , ';
            }
            return content
        },
        set_shipping_client: function (client) {
            this.assert_editable();
            this.set('client', client);
            this.shipping_client = client;
        },
        do_partial_payment: function () {
            var client = null;
            if (this) {
                client = this.get_client();
            }
            if (!client) {
                return this.pos.gui.show_screen('clientlist');
            }
            if (this.is_return || this.get_total_with_tax() <= 0) {
                return this.pos.gui.show_popup('confirm', {
                    title: _t('Warning'),
                    body: _t('this Return or Amount with tax smaller than 0 not allow do partial payment'),
                });
            }
            this.partial_payment = true;
            this.trigger('change', this);
            this.pos.push_order(this, {draft: true});
            this.pos.gui.show_screen('receipt');
        },
        save_order_to_quotation: function (pos_session_id) {
            var self = this;
            if (this.is_return || this.get_total_with_tax() <= 0) {
                return this.pos.gui.show_popup('confirm', {
                    title: _t('Warning'),
                    body: _t('this Return or Amount with tax smaller than 0 not allow do partial payment'),
                });
            }
            this['pos_session_id'] = pos_session_id;
            this.pos.push_order(this, {draft: true}).then(function (oder_ids) {
                rpc.query({
                    model: 'pos.order',
                    method: 'write',
                    args: [oder_ids, {
                        'state': 'quotation',
                        'is_quotation': true
                    }],
                })
                return self.pos.gui.show_screen('receipt');
            });
        },
        set_client: function (client) {
            var self = this;
            var current_screen = this.pos.gui.get_current_screen();
            if (current_screen == 'receipt') { // TODO: if current screen is receipt, no need to checking anything
                return _super_Order.set_client.apply(this, arguments);
            }
            var res = _super_Order.set_client.apply(this, arguments);
            if (client) {
                var partial_payment_orders = _.filter(this.pos.db.get_pos_orders(), function (order) {
                    return order['partner_id'] && order['partner_id'][0] == client['id'] && order['state'] == 'draft';
                });
                if (partial_payment_orders.length != 0) {
                    var warning_message = 'Customer selected have orders: ';
                    for (var i = 0; i < partial_payment_orders.length; i++) {
                        warning_message += partial_payment_orders[i]['name'];
                        warning_message += '(' + partial_payment_orders[i]['date_order'] + ')';
                        if ((i + 1) == partial_payment_orders.length) {
                            warning_message += ' .';
                        } else {
                            warning_message += ',';
                        }
                    }
                    warning_message += ' not payment full';
                    this.pos.gui.show_popup('confirm', {
                        title: client.name,
                        body: warning_message,
                    })
                }
                if (client.group_ids.length > 0) {
                    var list = [];
                    for (var i = 0; i < client.group_ids.length; i++) {
                        var group_id = client.group_ids[i];
                        var group = this.pos.membership_group_by_id[group_id];
                        if (group.pricelist_id) {
                            list.push({
                                'label': group.name,
                                'item': group
                            });
                        }
                    }
                    if (list.length > 0 && this.pos.gui.popup_instances['selection']) {
                        setTimeout(function () {
                            self.pos.gui.show_popup('selection', {
                                title: _t('Please add group/membership to customer ' + client.name),
                                list: list,
                                confirm: function (group) {
                                    if (!self.pos.pricelist_by_id || !self.pos.pricelist_by_id[group.pricelist_id[0]]) {
                                        return self.pos.gui.show_popup('dialog', {
                                            title: _t('Warning'),
                                            body: _t('Your POS not added pricelist') + group.pricelist_id[1],
                                        })
                                    }
                                    var pricelist = self.pos.pricelist_by_id[group.pricelist_id[0]];
                                    var order = self.pos.get_order();
                                    if (order && pricelist) {
                                        order.set_pricelist(pricelist);
                                        return self.pos.gui.show_popup('dialog', {
                                            title: _t('Succeed'),
                                            body: group.pricelist_id[1] + ' added',
                                            color: 'success'
                                        })
                                    }
                                }
                            });
                        }, 1000);
                    }
                }
            }
            return res
        },
        validate_medical_insurance: function () {
            var lines = this.orderlines.models;
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (line['medical_insurance']) {
                    this.remove_orderline(line);
                }
            }
            if (this.medical_insurance) {
                var total_without_tax = this.get_total_without_tax();
                var product = this.pos.db.product_by_id[this.medical_insurance.product_id[0]]
                var price = total_without_tax / 100 * this.medical_insurance.rate
                this.add_product(product, {
                    price: price,
                    quantity: -1
                });
                var selected_line = this.get_selected_orderline();
                selected_line['medical_insurance'] = true;
                selected_line.discount_reason = this.medical_insurance.name;
                selected_line.trigger('trigger_update_line', selected_line);
                selected_line.trigger('change', selected_line);
            }
        },
        validate_global_discount: function () {
            var self = this;
            var client = this && this.get_client();
            if (client && client['discount_id']) {
                this.pos.gui.show_screen('products');
                this.discount = this.pos.discount_by_id[client['discount_id'][0]];
                this.pos.gui.show_screen('products');
                var body = client['name'] + ' have discount ' + self.discount['name'] + '. Do you want to apply ?';
                return this.pos.gui.show_popup('confirm', {
                    'title': _t('Customer special discount ?'),
                    'body': body,
                    confirm: function () {
                        self.add_global_discount(self.discount);
                        self.pos.gui.show_screen('payment');
                        self.validate_payment();
                    },
                    cancel: function () {
                        self.pos.gui.show_screen('payment');
                        self.validate_payment();
                    }
                });
            } else {
                this.validate_payment();
            }
        },
        validate_payment: function () {
            if (this.pos.config.validate_payment) { // TODO: validate payment
                this.pos.gui.show_screen('products');
                this.pos._validate_by_manager("this.pos.gui.show_screen('payment')", 'Do Payment Order');
            }
        },
        validate_payment_order: function () {
            var self = this;
            var client = this.get_client();
            if (this.pos.config.multi_lots) {
                var orderlines = this.orderlines.models; // checking multi lots
                for (var i = 0; i < orderlines.length; i++) {
                    var orderline = orderlines[i];
                    if (orderline.product.tracking == 'lot') {
                        if (!orderline.lot_ids) {
                            this.pos.gui.show_screen('products');
                            return this.pos.gui.show_popup('confirm', {
                                'title': _t('Error'),
                                'body': _t('Product ' + orderline.product.display_name + ' null lots. Because your pos active multi lots, required add lots')
                            });
                        }
                        var sum = 0;
                        for (var j = 0; j < orderline.lot_ids.length; j++) {
                            sum += parseFloat(orderline.lot_ids[j]['quantity'])
                        }
                        if (sum != orderline.quantity && sum != 0) {
                            this.pos.gui.show_screen('products');
                            return this.pos.gui.show_popup('confirm', {
                                'title': _t('Lots of Product: ') + orderline.product.display_name + _(' have wrongs'),
                                'body': _t('Total quantity of lines is: ' + orderline.quantity + _t(', but you only input total quantities of lots is: ') + sum)
                            });
                        }
                    }
                }
            }
            if (!client && this.pos.config.add_customer_before_products_already_in_shopping_cart) {
                setTimeout(function () {
                    self.pos.gui.show_screen('products');
                    self.pos.gui.show_screen('clientlist');
                    self.pos.gui.show_popup('dialog', {
                        title: _t('Warning'),
                        body: _t('Please add client the first')
                    })
                }, 300);
            }
            if (this && this.orderlines.models.length == 0) {
                this.pos.gui.show_screen('products');
                return this.pos.gui.show_popup('dialog', {
                    title: _t('Warning'),
                    body: _t('Your order cart is blank')
                })
            }
            if (this.remaining_point && this.remaining_point < 0) {
                this.pos.gui.show_screen('products');
                return this.pos.gui.show_popup('dialog', {
                    title: _t('Warning'),
                    body: _t('You could not applied redeem point bigger than client point'),
                });
            }
            this.validate_order_return();
            if (!this.is_return) {
                this.validate_promotion();
                this.validate_medical_insurance();
            }
            if (this.is_to_invoice() && !this.get_client()) {
                this.pos.gui.show_screen('clientlist');
                this.pos.gui.show_popup('dialog', {
                    title: _t('Warning'),
                    body: _t('Please add client the first')
                });
                return false;
            }
            return true
        },
        validate_order_return: function () {
            if (this.pos.config.required_reason_return) {
                var line_missed_input_return_reason = _.find(this.orderlines.models, function (line) {
                    return line.get_price_with_tax() < 0 && !line.has_input_return_reason();
                });
                if (line_missed_input_return_reason) {
                    this.pos.gui.show_screen('products');
                    return this.pos.gui.show_popup('dialog', {
                        title: _t('Alert'),
                        body: _t('Please input return reason for each line'),
                    });
                } else {
                    return false
                }
            } else {
                return false
            }
        },
        add_global_discount: function (discount) {
            var lines = this.orderlines.models;
            if (!lines.length) {
                return this.pos.gui.show_popup('confirm', {
                    title: _t('Warning'),
                    body: _t('Please add product first, your order cart is empty')
                })
            }
            if (discount.type == 'percent') {
                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i];
                    line.discount_extra = discount.amount;
                    line.trigger('change', line)
                }
            } else {
                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i];
                    line.price_extra = -discount.amount / lines.length;
                    line.trigger('change', line)
                }
            }
        },
        set_discount_value: function (discount) {
            var order = this;
            var lines = order.get_orderlines();
            var product = this.pos.db.get_product_by_id(this.pos.config.discount_product_id[0]);
            if (product === undefined) {
                this.pos.gui.show_popup('error', {
                    title: _t("No discount product found"),
                    body: _t("The discount product seems misconfigured. Make sure it is flagged as 'Can be Sold' and 'Available in Point of Sale'."),
                });
                return;
            }
            var i = 0;
            while (i < lines.length) {
                if (lines[i].get_product().id === product.id) {
                    order.remove_orderline(lines[i]);
                } else {
                    i++;
                }
            }
            var base_to_discount = order.get_total_without_tax();
            if (product.taxes_id.length) {
                var first_tax = this.pos.taxes_by_id[product.taxes_id[0]];
                if (first_tax.price_include) {
                    base_to_discount = order.get_total_with_tax();
                }
            }
            if (base_to_discount <= discount) {
                return this.pos.gui.show_popup('error', {
                    title: _t("Error"),
                    body: _t("If set this discount, order total amount become smaller than 0, could not apply"),
                });
            }
            if (this.pos.config.discount_value_limit < discount) {
                return this.pos.gui.show_popup('error', {
                    title: _t("Error"),
                    body: _t("It not possible sell discount bigger than " + this.pos.gui.chrome.format_currency_no_symbol(this.pos.config.discount_value_limit)),
                });
            }
            order.add_product(product, {
                quantity: -1,
                price: discount,
                lst_price: discount,
                extras: {
                    price_manually_set: true,
                },
            });
        },
        set_to_invoice: function (to_invoice) {
            if (to_invoice) {
                this.add_credit = false;
                this.trigger('change');
            }
            return _super_Order.set_to_invoice.apply(this, arguments);
        },
        is_add_credit: function () {
            return this.add_credit
        },
        add_order_credit: function () {
            this.add_credit = !this.add_credit;
            if (this.add_credit) {
                this.set_to_invoice(false);
            }
            this.trigger('change');
            if (this.add_credit && !this.get_client()) {
                this.pos.gui.show_screen('clientlist');
                return this.pos.gui.show_popup('dialog', {
                    title: 'Warning',
                    body: 'Please add customer need add credit'
                })
            }
        },
        is_email_invoice: function () { // send email invoice or not
            return this.email_invoice;
        },
        set_email_invoice: function (email_invoice) {
            this.assert_editable();
            this.email_invoice = email_invoice;
            this.set_to_invoice(email_invoice);
        },
        get_root_category_by_category_id: function (category_id) { // get root of category, root is parent category is null
            var root_category_id = category_id;
            var category_parent_id = this.pos.db.category_parent[category_id];
            if (category_parent_id) {
                root_category_id = this.get_root_category_by_category_id(category_parent_id)
            }
            return root_category_id
        },
        // odoo wrong when compute price with tax have option price included
        // and now i fixing
        fix_tax_included_price: function (line) {
            this.syncing = true;
            _super_Order.fix_tax_included_price.apply(this, arguments);
            if (this.fiscal_position) {
                var unit_price = line.product['lst_price'];
                var taxes = line.get_taxes();
                var mapped_included_taxes = [];
                _(taxes).each(function (tax) {
                    var line_tax = line._map_tax_fiscal_position(tax);
                    if (tax.price_include && tax.id != line_tax.id) {
                        mapped_included_taxes.push(tax);
                    }
                });
                if (mapped_included_taxes.length > 0) {
                    unit_price = line.compute_all(mapped_included_taxes, unit_price, 1, this.pos.currency.rounding, true).total_excluded;
                    line.set_unit_price(unit_price);
                }
            }
            this.syncing = false;
        },
        set_signature: function (signature) {
            this.signature = signature;
            this.trigger('change', this);
        },
        get_signature: function () {
            if (this.signature) {
                return 'data:image/png;base64, ' + this.signature
            } else {
                return null
            }
        },
        set_note: function (note) {
            this.note = note;
            this.trigger('change', this);
        },
        get_note: function (note) {
            return this.note;
        },
        active_button_add_wallet: function (active) {
            var $add_wallet = $('.add_wallet');
            if (!$add_wallet) {
                return;
            }
            if (active) {
                $add_wallet.removeClass('oe_hidden');
                $add_wallet.addClass('highlight')
            } else {
                $add_wallet.addClass('oe_hidden');
            }
        },
        get_due_without_rounding: function (paymentline) {
            if (!paymentline) {
                var due = this.get_total_with_tax() - this.get_total_paid();
            } else {
                var due = this.get_total_with_tax();
                var lines = this.paymentlines.models;
                for (var i = 0; i < lines.length; i++) {
                    if (lines[i] === paymentline) {
                        break;
                    } else {
                        due -= lines[i].get_amount();
                    }
                }
            }
            return due;
        },
        generate_unique_ean13: function (array_code) {
            if (array_code.length != 12) {
                return -1
            }
            var evensum = 0;
            var oddsum = 0;
            for (var i = 0; i < array_code.length; i++) {
                if ((i % 2) == 0) {
                    evensum += parseInt(array_code[i])
                } else {
                    oddsum += parseInt(array_code[i])
                }
            }
            var total = oddsum * 3 + evensum;
            return parseInt((10 - total % 10) % 10)
        },
        get_product_image_url: function (product) {
            return window.location.origin + '/web/image?model=product.product&field=image_128&id=' + product.id;
        },
        add_product: function (product, options) {
            function check_condition_apply_sale_limit_time(pos, pos_category) {
                if (pos_category.submit_all_pos) {
                    return true
                } else {
                    if (pos_category.pos_branch_ids.length) {
                        if (!pos.config.pos_branch_id) {
                            return true
                        } else {
                            return (pos_category.pos_branch_ids.indexOf(pos.config.pos_branch_id[0]) != -1)
                        }
                    } else {
                        if (pos_category.pos_config_ids) {
                            return (pos_category.pos_config_ids.indexOf(pos.config.id) != -1)
                        } else {
                            return false
                        }
                    }
                }
            }

            if (product && product['pos_categ_id']) {
                var pos_category = this.pos.pos_category_by_id[product['pos_categ_id'][0]];
                if (pos_category && pos_category.sale_limit_time) {
                    var can_apply = check_condition_apply_sale_limit_time(this.pos, pos_category);
                    if (can_apply) {
                        var limit_sale_from_time = pos_category.from_time;
                        var limit_sale_to_time = pos_category.to_time;
                        var date_now = new Date();
                        var current_time = date_now.getHours() + date_now.getMinutes() / 600;
                        if (current_time >= limit_sale_from_time && current_time <= limit_sale_to_time) {
                            return this.pos.gui.show_popup('confirm', {
                                title: _t('Warning'),
                                body: pos_category.name + _(' Only allow sale from time: ' + limit_sale_from_time + ' to time: ' + limit_sale_to_time)
                            })
                        }
                    }
                }
            }
            var res = _super_Order.add_product.apply(this, arguments);
            var selected_orderline = this.get_selected_orderline();
            var combo_items = [];
            if (selected_orderline) {
                // TODO: auto set hardcode combo items
                for (var i = 0; i < this.pos.combo_items.length; i++) {
                    var combo_item = this.pos.combo_items[i];
                    if (combo_item.product_combo_id[0] == selected_orderline.product.product_tmpl_id && (combo_item.default == true || combo_item.required == true)) {
                        combo_items.push(combo_item);
                    }
                }
                if (combo_items) {
                    selected_orderline.set_combo_bundle_pack(combo_items)
                }
                // TODO: auto set dynamic combo items
                if (selected_orderline.product.product_tmpl_id) {
                    var default_combo_items = this.pos.combo_limiteds_by_product_tmpl_id[selected_orderline.product.product_tmpl_id];
                    if (default_combo_items && default_combo_items.length) {
                        var selected_combo_items = {};
                        for (var i = 0; i < default_combo_items.length; i++) {
                            var default_combo_item = default_combo_items[i];
                            if (default_combo_item.default_product_ids.length) {
                                for (var j = 0; j < default_combo_item.default_product_ids.length; j++) {
                                    selected_combo_items[default_combo_item.default_product_ids[j]] = 1
                                }
                            }
                        }
                        selected_orderline.set_dynamic_combo_items(selected_combo_items);
                    }

                }
                if (selected_orderline.product.cross_selling) {
                    selected_orderline.show_cross_sale();
                }
                if (selected_orderline.product.multi_variant && this.pos.variant_by_product_tmpl_id[selected_orderline.product.product_tmpl_id]) {
                    if (this.pos.gui.popup_instances['popup_select_variants']) {
                        var variants = this.pos.variant_by_product_tmpl_id[selected_orderline.product.product_tmpl_id];
                        this.pos.gui.show_popup('popup_select_variants', {
                            variants: variants,
                            selected_orderline: selected_orderline,
                        });
                    }
                }
                if (product.note_ids) {
                    var notes = '';
                    for (var i = 0; i < product.note_ids.length; i++) {
                        var note = this.pos.note_by_id[product.note_ids[i]];
                        if (!notes) {
                            notes = note.name
                        } else {
                            notes += ', ' + note.name;
                        }
                    }
                    if (notes) {
                        selected_orderline.set_line_note(notes)
                    }
                }
                if (product.tag_ids) {
                    selected_orderline.set_tags(product.tag_ids)
                }
                selected_orderline.change_unit();
            }
            return res
        },
        validation_order_can_do_internal_transfer: function () {
            var can_do = true;
            for (var i = 0; i < this.orderlines.models.length; i++) {
                var product = this.orderlines.models[i].product;
                if (product['type'] == 'service' || product['uom_po_id'] == undefined) {
                    can_do = false;
                }
            }
            if (this.orderlines.models.length == 0) {
                can_do = false;
            }
            return can_do;
        },
        update_product_price: function (pricelist) {
            var self = this;
            var products = this.pos.db.get_product_by_category(0);
            if (!products) {
                return;
            }
            for (var i = 0; i < products.length; i++) {
                var product = products[i];
                var price = this.pos.get_price(product, pricelist, 1);
                product['price'] = price;
            }
            self.pos.trigger('product:change_price_list', products)
        },
        get_total_items: function () {
            var total_items = 0;
            for (var i = 0; i < this.orderlines.models.length; i++) {
                total_items += this.orderlines.models[i].quantity;
            }
            return total_items;
        }
    });

    var _super_Orderline = models.Orderline.prototype;
    models.Orderline = models.Orderline.extend({
        initialize: function (attributes, options) {
            var res = _super_Orderline.initialize.apply(this, arguments);
            if (!options.json) {
                // TODO: if sync between session active auto set seller is user assigned
                if (this.pos.config.sync_multi_session && this.pos.config.user_id) {
                    var seller = this.pos.user_by_id[this.pos.config.user_id[0]];
                    if (seller) {
                        this.set_sale_person(seller)
                    }
                }
                // TODO: if default seller auto set user_id for pos_order_line
                if (this.pos.default_seller) {
                    this.set_sale_person(this.pos.default_seller)
                }
                this.selected_combo_items = {};
            }
            return res;
        },
        init_from_JSON: function (json) {
            var res = _super_Orderline.init_from_JSON.apply(this, arguments);
            if (json.price_extra) {
                this.price_extra = json.price_extra;
            }
            if (json.discount_extra) {
                this.discount_extra = json.discount_extra
            }
            if (json.user_id) {
                var seller = this.pos.user_by_id[json.user_id];
                if (seller) {
                    this.set_sale_person(seller)
                }
            }
            if (json.tag_ids && json.tag_ids.length) {
                var tag_ids = json.tag_ids[0][2];
                if (tag_ids) {
                    this.set_tags(tag_ids)
                }
            }
            if (json.is_return) {
                this.is_return = json.is_return;
            }
            if (json.combo_item_ids && json.combo_item_ids.length) {
                this.set_combo_bundle_pack(json.combo_item_ids)
            }
            if (json.variant_ids && json.variant_ids.length) {
                var variant_ids = json.variant_ids[0][2];
                if (variant_ids) {
                    this.set_variants(variant_ids)
                }
            }
            if (json.uom_id) {
                this.uom_id = json.uom_id;
                var unit = this.pos.units_by_id[json.uom_id];
                if (unit) {
                    this.product.uom_id = [unit['id'], unit['name']];
                }
            }
            if (json.note) {
                this.note = json.note;
            }
            if (json.discount_reason) {
                this.discount_reason = json.discount_reason
            }
            if (json.medical_insurance) {
                this.medical_insurance = json.medical_insurance;
            }
            if (json.frequent_buyer_id) {
                this.frequent_buyer_id = json.frequent_buyer_id;
            }
            if (json.packaging_id && this.pos.packaging_by_id && this.pos.packaging_by_id[json.packaging_id]) {
                this.packaging = this.pos.packaging_by_id[json.packaging_id];
            }
            if (json.lot_ids) {
                this.lot_ids = json.lot_ids;
            }
            if (json.manager_user_id && this.pos.user_by_id && this.pos.user_by_id[json.manager_user_id]) {
                this.manager_user = this.pos.user_by_id[json.manager_user_id]
            }
            if (json.base_price) {
                this.set_unit_price(json.base_price);
                this.base_price = null;
            }
            if (json.selected_combo_items) {
                this.set_dynamic_combo_items(json.selected_combo_items)
            }
            if (json.returned_order_line_id) {
                this.returned_order_line_id = json.returned_order_line_id
            }
            return res;
        },
        export_as_JSON: function () {
            var json = _super_Orderline.export_as_JSON.apply(this, arguments);
            if (this.price_extra) {
                json.price_extra = this.price_extra;
            }
            if (this.discount_extra) {
                json.discount_extra = this.discount_extra;
            }
            if (this.seller) {
                json.user_id = this.seller.id;
            }
            if (this.base_price) {
                json.base_price = this.base_price;
            }
            if (this.tags && this.tags.length) {
                json.tag_ids = [[6, false, _.map(this.tags, function (tag) {
                    return tag.id;
                })]];
            }
            if (this.get_line_note()) {
                json.note = this.get_line_note();
            }
            if (this.is_return) {
                json.is_return = this.is_return;
            }
            if (this.combo_items && this.combo_items.length) {
                json.combo_item_ids = [];
                for (var n = 0; n < this.combo_items.length; n++) {
                    json.combo_item_ids.push({
                        id: this.combo_items[n].id,
                        quantity: this.combo_items[n].quantity
                    })
                }
            }
            if (this.uom_id) {
                json.uom_id = this.uom_id
            }
            if (this.variants && this.variants.length) {
                json.variant_ids = [[6, false, _.map(this.variants, function (variant) {
                    return variant.id;
                })]];
            }
            if (this.discount_reason) {
                json.discount_reason = this.discount_reason
            }
            if (this.medical_insurance) {
                json.medical_insurance = this.medical_insurance
            }
            if (this.frequent_buyer_id) {
                json.frequent_buyer_id = this.frequent_buyer_id
            }
            if (this.packaging) {
                json.packaging_id = this.packaging.id
            }
            if (this.lot_ids) {
                var pack_lot_ids = json.pack_lot_ids;
                for (var i = 0; i < this.lot_ids.length; i++) {
                    var lot = this.lot_ids[i];
                    pack_lot_ids.push([0, 0, {
                        lot_name: lot['name'],
                        quantity: lot['quantity'],
                        lot_id: lot['id']
                    }]);
                }
                json.pack_lot_ids = pack_lot_ids;
            }
            if (this.manager_user) {
                json.manager_user_id = this.manager_user.id
            }
            if (this.selected_combo_items) {
                json.selected_combo_items = this.selected_combo_items;
            }
            if (this.returned_order_line_id) {
                json.returned_order_line_id = this.returned_order_line_id;
            }
            return json;
        },
        clone: function () {
            var orderline = _super_Orderline.clone.call(this);
            orderline.note = this.note;
            return orderline;
        },
        export_for_printing: function () {
            var receipt_line = _super_Orderline.export_for_printing.apply(this, arguments);
            receipt_line['combo_items'] = [];
            receipt_line['variants'] = [];
            receipt_line['tags'] = [];
            receipt_line['note'] = this.note || '';
            receipt_line['combo_items'] = [];
            if (this.combo_items) {
                receipt_line['combo_items'] = this.combo_items;
            }
            if (this.variants) {
                receipt_line['variants'] = this.variants;
            }
            if (this.tags) {
                receipt_line['tags'] = this.tags;
            }
            if (this.discount_reason) {
                receipt_line['discount_reason'] = this.discount_reason;
            }
            receipt_line['tax_amount'] = this.get_tax() || 0.00;
            if (this.variants) {
                receipt_line['variants'] = this.variants;
            }
            if (this.packaging) {
                receipt_line['packaging'] = this.packaging;
            }
            if (this.product.name_second) {
                receipt_line['name_second'] = this.product.name_second
            }
            if (this.selected_combo_items) {
                receipt_line['selected_combo_items'] = this.selected_combo_items;
            }
            return receipt_line;
        },
        // compute_all: function(taxes, price_unit, quantity, currency_rounding) {
        //     // TODO: fix issue like bellow
        //     // - Company A and B: A have tax a1 and a2, B have tax b1 and b2
        //     // - On product X: set tax b1 or b2
        //     // - On User A: set company A
        //     // - User A load Product X (tax_id stored when install indexdb database), but account.tax loaded on pos have not tax_id b1 or b2
        //     var values = _super_Orderline.compute_all.call(this, taxes, price_unit, quantity, currency_rounding);
        //     var taxes = values['taxes'];
        //     taxes = _.filter(taxes, function (tax) {
        //         return tax != undefined
        //     });
        //     values['taxes'] = taxes;
        //     return values
        // },
        get_margin: function () {
            if (this.product.standard_price <= 0) {
                return 100
            } else {
                return (this.price - this.product.standard_price) / this.product.standard_price * 100
            }
        },
        set_multi_lot: function (lot_ids) {
            var lot_selected = [];
            for (var i = 0; i < lot_ids.length; i++) {
                var lot = lot_ids[i];
                var lot_record = this.pos.lot_by_id[lot['id']];
                if (lot_record && lot['quantity'] && lot['quantity'] > 0) {
                    lot['name'] = lot_record['name'];
                    lot_selected.push(lot)
                } else {
                    return this.pos.gui.show_popup('confirm', {
                        title: _t('Warning'),
                        body: _t('Lot ' + lot_record.id + ' does not exist. Backend system have removed it, it not possible made return with Lots')
                    })
                }
            }
            this.lot_ids = lot_selected;
            this.trigger('change', this);
            this.trigger('trigger_update_line');
        },
        set_line_note: function (note) {
            this.note = note;
            this.trigger('change', this);
        },
        // TODO: this is combo bundle pack
        set_combo_bundle_pack: function (combo_item_ids) {
            var price_extra = 0;
            this.combo_items = [];
            for (var n = 0; n < combo_item_ids.length; n++) {
                var combo_item_id = combo_item_ids[n].id;
                var quantity = combo_item_ids[n].quantity;
                var combo_item = this.pos.combo_item_by_id[combo_item_id];
                if (combo_item) {
                    this.combo_items.push({
                        id: combo_item['id'],
                        quantity: quantity,
                        price_extra: combo_item.price_extra,
                        product_id: combo_item.product_id,
                    });
                    price_extra += combo_item.price_extra * quantity;
                }
            }
            if (this.combo_items.length) {
                this.price_extra = price_extra;
                this.trigger('change', this);
                this.pos.gui.show_popup('dialog', {
                    title: _t('Alert'),
                    body: _t('Automatic set Items of Combo Bundle/Pack to ' + selected_orderline.product.display_name),
                    color: 'success'
                })
            }
        },
        // TODO: this is dynamic combo ( selected_combo_items is {product_id: quantity} )
        set_dynamic_combo_items: function (selected_combo_items) {
            var price_extra = 0;
            for (var product_id in selected_combo_items) {
                var product = this.pos.db.product_by_id[parseInt(product_id)];
                price_extra += product['combo_price'] * selected_combo_items[product_id];
            }
            this.selected_combo_items = selected_combo_items;
            this.price_extra = price_extra;
            this.trigger('change', this);
        },
        set_tags: function (tag_ids) {
            this.tags = [];
            for (var index in tag_ids) {
                var tag_id = tag_ids[index];
                var tag = this.pos.tag_by_id[tag_id];
                if (tag) {
                    this.tags.push(tag)
                }
            }
            if (this.tags.length) {
                this.trigger('change', this);
            }
        },
        set_discount_price: function (price_will_discount, tax) {
            if (tax.include_base_amount) {
                var line_subtotal = this.get_price_with_tax() / this.quantity;
                var tax_before_discount = (line_subtotal - line_subtotal / (1 + tax.amount / line_subtotal));
                var price_before_discount = line_subtotal - tax_before_discount; // b
                var tax_discount = price_will_discount - price_will_discount / (1 + tax.amount / price_will_discount);
                var price_discount = price_will_discount - tax_discount; // d
                var price_exincluded_discount = price_before_discount - price_discount;
                var new_tax_wihtin_discount = price_exincluded_discount - price_exincluded_discount / (1 + tax.amount / price_exincluded_discount);
                var new_price_wihtin_discount = line_subtotal - price_will_discount;
                var new_price_without_tax = new_price_wihtin_discount - new_tax_wihtin_discount;
                var new_price_within_tax = new_price_without_tax + new_tax_wihtin_discount;
                this.set_unit_price(new_price_within_tax);
            } else {
                var tax_discount = tax.amount / 100 * price_will_discount;
                var price_discount = price_will_discount - tax_discount;
                var new_price_within_tax = this.price - price_discount - (0.91 * (parseInt(price_will_discount / 100)));
                this.set_unit_price(new_price_within_tax);
            }
        },
        get_price_included_tax_by_price_of_item: function (price_unit, quantity) {
            var taxtotal = 0;
            var product = this.get_product();
            var taxes_ids = product.taxes_id;
            var taxes = this.pos.taxes;
            var taxdetail = {};
            var product_taxes = [];

            _(taxes_ids).each(function (el) {
                product_taxes.push(_.detect(taxes, function (t) {
                    return t.id === el;
                }));
            });

            var all_taxes = this.compute_all(product_taxes, price_unit, quantity, this.pos.currency.rounding);
            _(all_taxes.taxes).each(function (tax) {
                taxtotal += tax.amount;
                taxdetail[tax.id] = tax.amount;
            });

            return {
                "priceWithTax": all_taxes.total_included,
                "priceWithoutTax": all_taxes.total_excluded,
                "tax": taxtotal,
                "taxDetails": taxdetail,
            };
        },
        set_unit_price: function (price) {
            var discount_product_id = null;
            if (this.pos.config.discount_product_id && this.pos.config.module_pos_discount) {
                discount_product_id = this.pos.config.discount_product_id[0]
            }
            var self = this;
            if (this.product && (parseFloat(price) < this.product.minimum_list_price) && !this.packaging && !this.promotion && this.product.id != discount_product_id) {
                return this.pos.gui.show_popup('number', {
                    'title': _t('Product have minimum price smaller list price, please input price need to change'),
                    'value': 0,
                    'confirm': function (price) {
                        return self.set_unit_price(price);
                    }
                })
            } else {
                _super_Orderline.set_unit_price.apply(this, arguments);
            }
        },
        set_unit_price_with_currency: function (price, currency) {
            if (currency.id != this.pos.currency.id) {
                if (!this.base_price) {
                    this.base_price = this.price;
                    this.price = price * 1 / currency.rate;
                } else {
                    this.price = this.base_price * 1 / currency.rate;
                }
            } else {
                if (this.base_price) {
                    this.price = this.base_price;
                }
            }
            this.currency = currency;
            this.trigger('change', this);

        },
        has_dynamic_combo_active: function () {
            var pos_categories_combo = _.filter(this.pos.pos_categories, function (categ) {
                return categ.is_category_combo
            });
            if (pos_categories_combo.length > 0) {
                return true
            } else {
                return false
            }
        },
        has_valid_product_lot: function () { //  TODO: is line multi lots or not
            if (this.lot_ids && this.lot_ids.length) {
                return true
            } else {
                return _super_Orderline.has_valid_product_lot.apply(this, arguments);
            }
        },
        has_input_return_reason: function () {
            if (this.tags && this.tags.length) {
                var reason = _.find(this.tags, function (reason) {
                    return reason.is_return_reason;
                });
                if (reason) {
                    return true
                } else {
                    return false
                }
            } else {
                return false
            }
        },
        has_multi_unit: function () {
            var product = this.product;
            var product_tmpl_id;
            if (product.product_tmpl_id instanceof Array) {
                product_tmpl_id = product.product_tmpl_id[0]
            } else {
                product_tmpl_id = product.product_tmpl_id;
            }
            var uom_items = this.pos.uoms_prices_by_product_tmpl_id[product_tmpl_id];
            if (!uom_items || !this.pos.config.change_unit_of_measure) {
                return false;
            }
            var base_uom_id = product['base_uom_id'];
            if (base_uom_id) {
                var base_uom = this.pos.uom_by_id[base_uom_id[0]];
                base_uom['price'] = product.lst_price;
                base_uom['uom_id'] = [base_uom['id'], base_uom['name']];
                uom_items = uom_items.concat(base_uom)
            }
            if (uom_items.length > 0) {
                return true
            }
        },
        set_taxes: function (tax_ids) { // TODO: add taxes to order line
            if (this.product) {
                this.product.taxes_id = tax_ids;
                this.trigger('change', this);
            }
        },
        get_unit_price: function () {
            var unit_price = _super_Orderline.get_unit_price.apply(this, arguments);
            if (this.price_extra) {
                unit_price += this.price_extra;
            }
            if (this.discount_extra && this.discount_extra > 0 && this.discount_extra <= 100) {
                unit_price = unit_price - (unit_price * this.discount_extra / 100)
            }
            return unit_price;
        },
        set_variants: function (variant_ids) { // TODO: add variants to order line
            var self = this;
            var price_extra = 0;
            this.variants = _.map(variant_ids, function (variant_id) {
                var variant = self.pos.variant_by_id[variant_id];
                if (variant) {
                    return variant
                }
            });
            for (var i = 0; i < this.variants.length; i++) {
                var variant = this.variants[i];
                price_extra += variant.price_extra * variant.quantity;
            }
            if (this.price_extra != price_extra) {
                this.price_extra = price_extra;
                this.trigger('change', this);
            }
        },
        get_product_price_quantity_item: function () {
            var product_tmpl_id = this.product.product_tmpl_id;
            if (product_tmpl_id instanceof Array) {
                product_tmpl_id = product_tmpl_id[0]
            }
            var product_price_quantities = this.pos.price_each_qty_by_product_tmpl_id[product_tmpl_id];
            if (product_price_quantities) {
                var product_price_quanty_temp = null;
                for (var i = 0; i < product_price_quantities.length; i++) {
                    var product_price_quantity = product_price_quantities[i];
                    if (this.quantity >= product_price_quantity['quantity']) {
                        if (!product_price_quanty_temp) {
                            product_price_quanty_temp = product_price_quantity;
                        } else {
                            if (product_price_quanty_temp['quantity'] <= product_price_quantity['quantity']) {
                                product_price_quanty_temp = product_price_quantity;
                            }
                        }
                    }
                }
                return product_price_quanty_temp;
            }
            return null
        },
        has_variants: function () {
            if (this.variants && this.variants.length && this.variants.length > 0) {
                return true
            } else {
                return false
            }
        },
        set_product_lot: function (product) {
            if (product) { // first install may be have old orders, this is reason made bug
                return _super_Orderline.set_product_lot.apply(this, arguments);
            } else {
                return null
            }
        },
        // if config product tax id: have difference tax of other company
        // but when load data account.tax, pos default only get data of current company
        // and this function return some item undefined
        get_taxes: function () {
            var taxes = _super_Orderline.export_for_printing.apply(this, arguments);
            var new_taxes = [];
            var taxes_ids = this.get_product().taxes_id;
            var taxes = [];
            for (var i = 0; i < taxes_ids.length; i++) {
                if (this.pos.taxes_by_id[taxes_ids[i]]) {
                    new_taxes.push(this.pos.taxes_by_id[taxes_ids[i]]);
                }
            }
            return new_taxes;
        },
        get_packaging: function () {
            if (!this || !this.product || !this.pos.packaging_by_product_id) {
                return false;
            }
            if (this.pos.packaging_by_product_id[this.product.id]) {
                return true
            } else {
                return false
            }
        },
        get_packaging_added: function () {
            if (this.packaging) {
                return this.packaging;
            } else {
                return false
            }
        },
        set_discount_to_line: function (discount) {
            if (discount != 0) {
                this.discount_reason = discount.reason;
                this.set_discount(discount.amount);
            } else {
                this.discount_reason = null;
                this.set_discount(0);
            }
        },
        set_unit: function (uom_id, price) {
            this.uom_id = uom_id;
            if (price) {
                this.set_unit_price(price);
            }
            this.price_manually_set = true;
            return true;
        },
        change_unit: function () {
            $('.uom-list').replaceWith();
            var product = this.product;
            var product_tmpl_id;
            if (product.product_tmpl_id instanceof Array) {
                product_tmpl_id = product.product_tmpl_id[0]
            } else {
                product_tmpl_id = product.product_tmpl_id;
            }
            var uom_items = this.pos.uoms_prices_by_product_tmpl_id[product_tmpl_id];
            if (!uom_items || !this.pos.config.change_unit_of_measure) {
                return;
            }
            var base_uom_id = product['base_uom_id'];
            if (base_uom_id) {
                var base_uom = this.pos.uom_by_id[base_uom_id[0]];
                base_uom['price'] = product.lst_price;
                base_uom['uom_id'] = [base_uom['id'], base_uom['name']];
                uom_items = uom_items.concat(base_uom)
            }
            if (uom_items.length) {
                $('.control-buttons-extend').empty();
                $('.control-buttons-extend').removeClass('oe_hidden');
                var multi_unit_widget = new MultiUnitWidget(this, {
                    uom_items: uom_items,
                    selected_line: this
                });
                multi_unit_widget.appendTo($('.control-buttons-extend'));
            }
        },
        change_cross_selling: function () {
            var self = this;
            var cross_items = _.filter(this.pos.cross_items, function (cross_item) {
                return cross_item['product_tmpl_id'][0] == self.product.product_tmpl_id;
            });
            if (cross_items.length) {
                this.pos.gui.show_popup('popup_cross_selling', {
                    title: _t('Please, Suggest Customer buy more products bellow'),
                    widget: this,
                    cross_items: cross_items
                });
            } else {
                this.pos.gui.show_popup('dialog', {
                    title: 'Warning',
                    body: 'You not active cross selling or product have not items cross selling'
                });
            }
        },
        get_number_of_order: function () {
            var uid = this.uid;
            var order = this.order;
            for (var i = 0; i < order.orderlines.models.length; i++) {
                var line = order.orderlines.models[i];
                if (line.uid == uid) {
                    return i + 1
                }
            }
        },
        get_sale_person: function () {
            return this.seller;
        },
        set_sale_person: function (seller) {
            if (this.pos.config.force_seller) {
                var order = this.order;
                _.each(order.orderlines.models, function (line) {
                    line.seller = seller;
                    line.trigger('change', line);
                });
                order.seller = seller;
            } else {
                this.seller = seller;
                this.trigger('change', this);
            }
            // this.order.trigger('change', this.order); // if trigger change order, process screen auto reload
        },
        get_price_without_quantity: function () {
            if (this.quantity != 0) {
                return this.get_price_with_tax() / this.quantity
            } else {
                return 0
            }
        },
        get_line_image: function () { // show image on receipt and orderlines
            return window.location.origin + '/web/image?model=product.product&field=image_128&id=' + this.product.id;
        },
        // ------------- **** --------------------------------------
        // when cashiers select line, auto pop-up cross sell items
        // or if product have suggestion items, render element show all suggestion items
        // ------------- **** --------------------------------------
        show_cross_sale: function () {
            var self = this;
            var cross_items = _.filter(this.pos.cross_items, function (cross_item) {
                return cross_item['product_tmpl_id'][0] == self.product.product_tmpl_id;
            });
            if (cross_items.length && this.pos.gui.popup_instances['popup_cross_selling']) {
                this.pos.gui.show_popup('popup_cross_selling', {
                    title: _t('Please, Suggest Customer buy more products bellow'),
                    widget: this,
                    cross_items: cross_items
                });
            }
        },
        is_has_tags: function () {
            if (!this.tags || this.tags.length == 0) {
                return false
            } else {
                return true
            }
        },
        is_multi_variant: function () {
            var variants = this.pos.variant_by_product_tmpl_id[this.product.product_tmpl_id];
            if (!variants) {
                return false
            }
            if (variants.length > 0) {
                return true;
            } else {
                return false;
            }
        },
        // TODO: method return disc value each line
        get_price_discount: function () {
            var price = this.get_unit_price() * (1.0 - (this.get_discount() / 100.0));
            var base_price = this.get_unit_price();
            return (base_price - price) * this.quantity
        },
        get_unit: function () {
            if (!this.uom_id) {
                var unit = _super_Orderline.get_unit.apply(this, arguments);
                return unit;
            } else {
                var unit_id = this.uom_id;
                var unit = this.pos.units_by_id[unit_id];
                return unit;
            }
        },
        is_multi_unit_of_measure: function () {
            var uom_items = this.pos.uoms_prices_by_product_tmpl_id[this.product.product_tmpl_id];
            if (!uom_items) {
                return false;
            }
            if (uom_items.length > 0) {
                return true;
            } else {
                return false;
            }
        },
        is_combo: function () {
            var combo_items = [];
            for (var i = 0; i < this.pos.combo_items.length; i++) {
                var combo_item = this.pos.combo_items[i];
                if (combo_item.product_combo_id[0] == this.product['product_tmpl_id']) {
                    combo_items.push(combo_item);
                }
            }
            if (combo_items.length > 0) {
                return true
            } else {
                return false;
            }
        },
        has_combo_item_tracking_lot: function () {
            var tracking = false;
            for (var i = 0; i < this.pos.combo_items.length; i++) {
                var combo_item = this.pos.combo_items[i];
                if (combo_item['tracking']) {
                    tracking = true;
                }
            }
            return tracking;
        },
        _validate_stock_on_hand: function (quantity) {
            var line_quantity = quantity;
            var product = this.product;
            var stock_datas = this.pos.db.stock_datas;
            if (product['type'] == 'product' && stock_datas && stock_datas[product.id] != undefined) {
                if (!quantity) {
                    line_quantity = this.quantity;
                }
                var stock_available = stock_datas[product.id];
                if (line_quantity > stock_available) {
                    return _t(product.name + ' available on stock is ' + stock_available + ' . Not allow sale bigger than this quantity')
                }
            }
            return true
        },
        set_quantity: function (quantity, keep_price) {
            var self = this;
            var update_combo_items = false;
            if (this.uom_id || this.redeem_point) {
                keep_price = 'keep price because changed uom id or have redeem point'
            }
            if (this.pos.the_first_load == false && quantity != 'remove' && !this.pos.config['allow_order_out_of_stock'] && quantity && quantity != 'remove' && this.order.syncing != true && this.product['type'] != 'service') {
                var current_qty = 0;
                for (var i = 0; i < this.order.orderlines.models.length; i++) {
                    var line = this.order.orderlines.models[i];
                    if (this.product.id == line.product.id && line.id != this.id) {
                        current_qty += line.quantity
                    }
                }
                current_qty += parseFloat(quantity);
                if (this.pos.db.stock_datas[this.product.id] && current_qty > this.pos.db.stock_datas[this.product.id] && this.product['type'] == 'product') {
                    var product = this.pos.db.get_product_by_id(this.product.id);
                    this.pos.gui.show_popup('dialog', { // TODO: only show dialog warning, when do payment will block
                        title: _t('Warning'),
                        body: product['name'] + _t(' available for sell is ') + this.pos.db.stock_datas[this.product.id],
                    });
                }
            }
            var qty_will_set = parseFloat(quantity);
            if (qty_will_set <= 0) {
                this.selected_combo_items = {}
                update_combo_items = true
            } else {
                for (var product_id in this.selected_combo_items) {
                    var qty_of_combo_item = this.selected_combo_items[product_id]
                    var new_qty = qty_will_set / this.quantity * qty_of_combo_item;
                    this.selected_combo_items[product_id] = new_qty
                    update_combo_items = true;
                }
            }
            var res = _super_Orderline.set_quantity.call(this, quantity, keep_price); // call style change parent parameter : keep_price
            if (update_combo_items) {
                this.set_dynamic_combo_items(this.selected_combo_items)
            }
            if (this.combo_items && this.pos.config.screen_type != 'kitchen') { // if kitchen screen, no need reset combo items
                this.trigger('change', this);
            }
            var get_product_price_quantity = this.get_product_price_quantity_item(); // product price filter by quantity of cart line. Example: buy 1 unit price 1, buy 10 price is 0.5
            if (get_product_price_quantity) {
                setTimeout(function () {
                    self.syncing = true;
                    self.set_unit_price(get_product_price_quantity['price_unit']);
                    self.syncing = false;
                }, 500)
            }
            var order = this.order;
            var orderlines = order.orderlines.models;
            if (!order.fiscal_position || orderlines.length != 0) {
                for (var i = 0; i < orderlines.length; i++) { // reset taxes_id of line
                    orderlines[i]['taxes_id'] = [];
                }
            }
            if (order.fiscal_position && orderlines.length) {
                var fiscal_position = order.fiscal_position;
                var fiscal_position_taxes_by_id = fiscal_position.fiscal_position_taxes_by_id
                if (fiscal_position_taxes_by_id) {
                    for (var number in fiscal_position_taxes_by_id) {
                        var fiscal_tax = fiscal_position_taxes_by_id[number];
                        var tax_src_id = fiscal_tax.tax_src_id;
                        var tax_dest_id = fiscal_tax.tax_dest_id;
                        if (tax_src_id && tax_dest_id) {
                            for (var i = 0; i < orderlines.length; i++) { // reset taxes_id of line
                                orderlines[i]['taxes_id'] = [];
                            }
                            for (var i = 0; i < orderlines.length; i++) { // append taxes_id of line
                                var line = orderlines[i];
                                var product = line.product;
                                var taxes_id = product.taxes_id;
                                for (var number in taxes_id) {
                                    var tax_id = taxes_id[number];
                                    if (tax_id == tax_src_id[0]) {
                                        orderlines[i]['taxes_id'].push(tax_dest_id[0]);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    for (var i = 0; i < orderlines.length; i++) { // reset taxes_id of line
                        orderlines[i]['taxes_id'] = [];
                    }
                }
            }
            return res;
        },
        get_line_note: function (note) {
            return this.note;
        },
        set_selected: function (selected) {
            var self = this;
            _super_Orderline.set_selected.apply(this, arguments);
            if (selected) {
                this.change_unit();
            }
            if (selected && this.product.cross_selling) {
                this.show_cross_sale()
            }
            if (!this.pos.line_selected_detail) {
                this.pos.line_selected_detail = new PosRetailProductScreenList.OrderSelectedLineDetail(this, {
                    selected_line: this,
                });
            }
        },
        can_be_merged_with: function (orderline) {
            var merge = _super_Orderline.can_be_merged_with.apply(this, arguments);
            if (orderline['combo_items'] || orderline.product.is_combo || orderline.is_return) {
                return false;
            }
            return merge
        }
    });
});
