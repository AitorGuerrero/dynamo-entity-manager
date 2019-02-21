"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class TransactionItemsLimitReached extends Error {
    constructor(itemsAmount) {
        super(`Dynamo accepts a maximum of 10 items, ${itemsAmount} provided`);
        this.name = "transactionItemsLimitReached";
    }
}
exports.default = TransactionItemsLimitReached;
