"use strict";
odoo.define('pos_retail.screen_receipt', function (require) {

    var screens = require('point_of_sale.screens');
    var core = require('web.core');
    var rpc = require('pos.rpc');
    var qweb = core.qweb;
    var BarcodeEvents = require('barcodes.BarcodeEvents').BarcodeEvents;

    screens.ReceiptScreenWidget.include({
        // TODO: when core active _onKeypadKeyDown, we turn off my event keyboard
        _onKeypadKeyDown: function (ev) {
            // if (this.buffered_key_events) {
            //     this.buffered_key_events = [];
            // }
            $(document).off('keydown.receipt_screen', this._event_keyboard);
            this._super(ev);
        },
        // TODO: so when core process end keyboard buffered keys, we turn on back my keyboard
        _handleBufferedKeys: function () {
            $(document).on('keydown.receipt_screen', this._event_keyboard);
            this._super();
        },
        // TODO: this is our event keyboard
        _on_event_keyboard: function (ev) {
            if (!_.contains(["INPUT", "TEXTAREA"], $(ev.target).prop('tagName'))) {
                this.buffered_keyboard.push(ev);
                this.timeout = setTimeout(_.bind(this._handle_event_keyboard, this), BarcodeEvents.max_time_between_keys_in_ms);
            }
        },
        _handle_event_keyboard: function () {
            for (var i = 0; i < this.buffered_keyboard.length; ++i) {
                var ev = this.buffered_keyboard[i];
                this.keyboard_handler(ev)
            }
            this.buffered_keyboard = [];
        },
        keyboard_handler: function (event) {
            var current_screen = this.pos.gui.get_current_screen();
            if (current_screen != 'receipt') {
                // todo: turn off event keyboard if user not still on receipt screen
                $(document).off('keydown.receipt_screen', this._event_keyboard);
                return true;
            }
            if (event.keyCode === 13) {
                this.click_next();
            }
            if (event.keyCode === 80) {
                this.print();
            }
        },
        close: function () {
            this._super();
            $(document).off('keydown.receipt_screen', this._event_keyboard);
        },
        init: function () {
            this._super.apply(this, arguments);
            this.buffered_keyboard = [];
        },
        start: function () {
            this._super();
            this._event_keyboard = this._on_event_keyboard.bind(this);
        },
        init_pos_before_calling: function (pos) {
            this.pos = pos;
        },
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.back_order').click(function () {
                var order = self.pos.get_order();
                if (order) {
                    self.pos.gui.show_screen('products');
                }
            });
        },
        show: function () {
            this.pos.gui.close_popup();
            this._super();
            $(document).on('keydown.receipt_screen', this._event_keyboard);
        },
        print: function () {
            this._super();
        },
        handle_auto_print: function () {
            if (this.pos.config.auto_print_web_receipt) {
                return false
            } else {
                return this._super();
            }
        },
        should_auto_print: function () {
            if (!this.pos.get_order() || this.pos.config.auto_print_web_receipt) { // TODO: if active both fuute 1. iface_prin_auto (odoo) and auto print of this module, will have issue
                return false
            } else {
                return this._super()
            }
        },
        render_change: function () {
            if (this.pos.get_order()) {
                return this._super();
            }
        },
        get_receipt_render_env: function () {
            var data_print = this._super();
            var orderlines_by_category_name = {};
            var order = this.pos.get_order();
            var orderlines = order.orderlines.models;
            var categories = [];
            if (this.pos.config.category_wise_receipt) {
                for (var i = 0; i < orderlines.length; i++) {
                    var line = orderlines[i];
                    var line_print = line.export_for_printing();
                    line['product_name_wrapped'] = line_print['product_name_wrapped'][0];
                    var pos_categ_id = line['product']['pos_categ_id'];
                    if (pos_categ_id && pos_categ_id.length == 2) {
                        var root_category_id = order.get_root_category_by_category_id(pos_categ_id[0]);
                        var category = this.pos.db.category_by_id[root_category_id];
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
            }
            data_print['orderlines_by_category_name'] = orderlines_by_category_name;
            data_print['categories'] = categories;
            data_print['total_paid'] = order.get_total_paid(); // save amount due if have (display on receipt of parital order)
            data_print['total_due'] = order.get_due(); // save amount due if have (display on receipt of parital order)
            data_print['invoice_ref'] = order.invoice_ref;
            data_print['picking_ref'] = order.picking_ref;
            data_print['order_fields_extend'] = order.order_fields_extend;
            data_print['delivery_fields_extend'] = order.delivery_fields_extend;
            data_print['invoice_fields_extend'] = order.invoice_fields_extend;
            return data_print
        },
        auto_next_screen: function () {
            var order = this.pos.get_order();
            var printed = false;
            if (order) {
                printed = order._printed;
            }
            if (this.pos.config.auto_print_web_receipt && !printed && order) {
                this.print();
                order._printed = true;

            }
            if (this.pos.config.auto_nextscreen_when_validate_payment && order) {
                this.click_next();
            }
        },
        actions_after_render_succeed_receipt: function () {
            if (this.pos.config.ticket_font_size) {
                this.$('.pos-receipt').css({'font-size': this.pos.config.ticket_font_size})
            }
            this.auto_next_screen();
        },
        render_receipt: function () {
            $('.ui-helper-hidden-accessible').replaceWith();
            var self = this;
            this.pos.report_html = qweb.render('OrderReceipt', this.get_receipt_render_env());
            if (this.pos.config.duplicate_receipt && this.pos.config.print_number > 1) {
                var contents = this.$('.pos-receipt-container');
                contents.empty();
                var i = 0;
                var data = this.get_receipt_render_env();
                while (i < this.pos.config.print_number) {
                    contents.append(qweb.render('OrderReceipt', data));
                    i++;
                }
            } else {
                this._super();
                var contents = this.$('.pos-receipt-container');
                contents.empty();
                var data = this.get_receipt_render_env();
                contents.append(qweb.render('OrderReceipt', data));
            }
            setTimeout(function () {
                self.actions_after_render_succeed_receipt();
            }, 1000)
        },
    });
});
