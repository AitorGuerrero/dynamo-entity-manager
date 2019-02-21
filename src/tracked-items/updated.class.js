"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tracked_item_class_1 = require("./tracked-item.class");
class UpdatedTrackedItem extends tracked_item_class_1.default {
    constructor(entity, tableConfig, version) {
        super(entity, tableConfig, version);
        this.entity = entity;
        this.tableConfig = tableConfig;
        this.version = version;
        this.setState();
    }
    setState() {
        this.initialStatus = JSON.stringify(this.entity);
    }
    get hasChanged() {
        return JSON.stringify(this.entity) !== this.initialStatus;
    }
}
exports.default = UpdatedTrackedItem;
