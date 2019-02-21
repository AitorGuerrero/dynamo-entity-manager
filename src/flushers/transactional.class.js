"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const error_flushing_class_1 = require("../error.flushing.class");
const created_class_1 = require("../tracked-items/created.class");
const deleted_class_1 = require("../tracked-items/deleted.class");
const updated_class_1 = require("../tracked-items/updated.class");
const add_version_condition_expression_function_1 = require("./add-version-condition-expression.function");
const add_version_to_create_item_function_1 = require("./add-version-to-create-item.function");
const add_version_to_update_item_function_1 = require("./add-version-to-update-item.function");
const error_transaction_items_limit_reached_class_1 = require("./error.transaction-items-limit-reached.class");
const maxTransactWriteElems = 10;
class TransactionalFlusher {
    /**
     * @param {DocumentClient} dc
     * @param {module:events.internal.EventEmitter} eventEmitter
     * @param options
     */
    constructor(dc, eventEmitter = new events_1.EventEmitter(), options = {}) {
        this.dc = dc;
        this.eventEmitter = eventEmitter;
        this.options = options;
        this.flushing = false;
    }
    static flushEntity(trackedItem) {
        if (trackedItem instanceof updated_class_1.default) {
            return TransactionalFlusher.updateItemTransactional(trackedItem);
        }
        if (trackedItem instanceof deleted_class_1.default) {
            return TransactionalFlusher.deleteItemTransactional(trackedItem);
        }
        if (trackedItem instanceof created_class_1.default) {
            return TransactionalFlusher.createItemTransactional(trackedItem);
        }
    }
    static createItemTransactional(trackedEntity) {
        const marshaledEntity = trackedEntity.tableConfig.marshal(trackedEntity.entity);
        return {
            Put: Object.assign(TransactionalFlusher.buildConditionExpression(marshaledEntity, trackedEntity.tableConfig), {
                Item: add_version_to_create_item_function_1.default(marshaledEntity, trackedEntity.tableConfig),
                TableName: trackedEntity.tableConfig.tableName,
            }),
        };
    }
    static buildConditionExpression(entity, tableConf) {
        const result = {
            ConditionExpression: "#keyHash<>:keyHash",
            ExpressionAttributeNames: { "#keyHash": tableConf.keySchema.hash },
            ExpressionAttributeValues: { ":keyHash": entity[tableConf.keySchema.hash] },
        };
        if (tableConf.keySchema.range !== undefined) {
            result.ConditionExpression = result.ConditionExpression + " and #keyRange<>:keyRange";
            result.ExpressionAttributeNames["#keyRange"] = tableConf.keySchema.range;
            result.ExpressionAttributeValues[":keyRange"] = entity[tableConf.keySchema.range];
        }
        return result;
    }
    static updateItemTransactional(trackedEntity) {
        const tableConfig = trackedEntity.tableConfig;
        if (!trackedEntity.hasChanged) {
            return;
        }
        return {
            Put: add_version_condition_expression_function_1.default(trackedEntity, {
                Item: add_version_to_update_item_function_1.default(tableConfig.marshal(trackedEntity.entity), trackedEntity),
                TableName: tableConfig.tableName,
            }),
        };
    }
    static deleteItemTransactional(trackedEntity) {
        return {
            Delete: add_version_condition_expression_function_1.default(trackedEntity, {
                Key: trackedEntity.getEntityKey(),
                TableName: trackedEntity.tableConfig.tableName,
            }),
        };
    }
    /**
     * Flushes all the changes made to loaded entities.
     * @returns {Promise<void>}
     */
    async flush(tracked) {
        try {
            await this.processOperations(this.buildOperations(tracked));
        }
        catch (err) {
            if (err instanceof error_transaction_items_limit_reached_class_1.default && this.options.onItemsLimitFallbackFlusher) {
                await this.options.onItemsLimitFallbackFlusher.flush(tracked);
            }
            else {
                throw err;
            }
        }
    }
    buildOperations(tracked) {
        const operations = [];
        for (const entityConfig of tracked.values()) {
            operations.push(TransactionalFlusher.flushEntity(entityConfig));
        }
        return operations.filter((i) => i !== undefined);
    }
    async processOperations(operations) {
        if (operations.length > maxTransactWriteElems) {
            this.eventEmitter.emit("maxTransactWriteElemsAlert");
            throw new error_transaction_items_limit_reached_class_1.default(operations.length);
        }
        for (let i = 0; i < operations.length; i += maxTransactWriteElems) {
            await this.processOperationsChunk(operations.slice(i, i + maxTransactWriteElems));
        }
    }
    async processOperationsChunk(operationsChunk) {
        try {
            await this.asyncTransaction({
                TransactItems: operationsChunk,
            });
        }
        catch (err) {
            this.flushing = false;
            this.eventEmitter.emit("error", new error_flushing_class_1.default(err));
            throw err;
        }
    }
    asyncTransaction(request) {
        return this.dc.transactWrite(request);
    }
}
exports.default = TransactionalFlusher;
