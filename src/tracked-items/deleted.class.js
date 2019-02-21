"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tracked_item_class_1 = require("./tracked-item.class");
class DeletedTrackedItem extends tracked_item_class_1.default {
    constructor(entity, tableConfig, version) {
        super(entity, tableConfig, version);
        this.entity = entity;
        this.tableConfig = tableConfig;
        this.version = version;
        this.initialStatus = JSON.stringify(entity);
    }
}
exports.default = DeletedTrackedItem;
