"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const created_class_1 = require("../tracked-items/created.class");
const deleted_class_1 = require("../tracked-items/deleted.class");
const updated_class_1 = require("../tracked-items/updated.class");
const add_version_condition_expression_function_1 = require("./add-version-condition-expression.function");
const add_version_to_create_item_function_1 = require("./add-version-to-create-item.function");
const add_version_to_update_item_function_1 = require("./add-version-to-update-item.function");
class ParallelFlusher {
    /**
     * @param {DocumentClient} dc
     * @param {module:events.internal.EventEmitter} eventEmitter
     */
    constructor(dc, eventEmitter = new events_1.EventEmitter()) {
        this.dc = dc;
        this.eventEmitter = eventEmitter;
        this.flushing = false;
    }
    /**
     * Flushes all the changes made to loaded entities.
     * @returns {Promise<void>}
     */
    async flush(tracked) {
        const processes = [];
        for (const entityConfig of tracked.values()) {
            if (entityConfig instanceof created_class_1.default) {
                processes.push(this.createItem(entityConfig));
            }
            else if (entityConfig instanceof updated_class_1.default) {
                processes.push(this.updateItem(entityConfig));
            }
            else if (entityConfig instanceof deleted_class_1.default) {
                processes.push(this.deleteItem(entityConfig));
            }
        }
        await Promise.all(processes);
    }
    async createItem(trackedEntity) {
        await this.dc.put({
            Item: add_version_to_create_item_function_1.default(trackedEntity.tableConfig.marshal(trackedEntity.entity), trackedEntity.tableConfig),
            TableName: trackedEntity.tableConfig.tableName,
        });
    }
    async updateItem(trackedEntity) {
        const tableConfig = trackedEntity.tableConfig;
        if (!trackedEntity.hasChanged) {
            return;
        }
        await this.dc.put(add_version_condition_expression_function_1.default(trackedEntity, {
            Item: add_version_to_update_item_function_1.default(tableConfig.marshal(trackedEntity.entity), trackedEntity),
            TableName: tableConfig.tableName,
        }));
    }
    async deleteItem(trackedEntity) {
        await this.dc.delete(add_version_condition_expression_function_1.default(trackedEntity, {
            Key: trackedEntity.getEntityKey(),
            TableName: trackedEntity.tableConfig.tableName,
        }));
    }
}
exports.default = ParallelFlusher;
