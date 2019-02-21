"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class TrackedItem {
    constructor(entity, tableConfig, version) {
        this.entity = entity;
        this.tableConfig = tableConfig;
        this.version = version;
    }
    getEntityKey() {
        const key = {};
        key[this.tableConfig.keySchema.hash] = this.entity[this.tableConfig.keySchema.hash];
        if (this.tableConfig.keySchema.range) {
            key[this.tableConfig.keySchema.range] = this.entity[this.tableConfig.keySchema.range];
        }
        return key;
    }
}
exports.default = TrackedItem;
