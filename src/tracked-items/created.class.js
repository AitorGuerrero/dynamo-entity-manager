"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tracked_item_class_1 = require("./tracked-item.class");
const updated_class_1 = require("./updated.class");
class CreatedTrackedItem extends tracked_item_class_1.default {
    constructor(entity, tableConfig) {
        super(entity, tableConfig, tableConfig.versionKey ? 0 : undefined);
        this.entity = entity;
        this.tableConfig = tableConfig;
    }
    toUpdate() {
        return new updated_class_1.default(this.entity, this.tableConfig, this.version);
    }
}
exports.default = CreatedTrackedItem;
