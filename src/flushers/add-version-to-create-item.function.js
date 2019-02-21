"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function addVersionToCreateItem(item, tableConfig) {
    if (tableConfig.versionKey !== undefined) {
        item[tableConfig.versionKey] = 0;
    }
    return item;
}
exports.default = addVersionToCreateItem;
