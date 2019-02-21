"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function addVersionConditionExpression(tracked, input) {
    if (tracked.tableConfig.versionKey !== undefined && tracked.version > 0) {
        input.ConditionExpression = "#version=:version";
        input.ExpressionAttributeNames = Object.assign({}, input.ExpressionAttributeNames, { "#version": tracked.tableConfig.versionKey });
        input.ExpressionAttributeValues = Object.assign({}, input.ExpressionAttributeValues, { ":version": tracked.version });
    }
    return input;
}
exports.default = addVersionConditionExpression;
