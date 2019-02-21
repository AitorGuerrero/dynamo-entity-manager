"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function addVersionToUpdateItem(item, trackedItem) {
    if (trackedItem.tableConfig.versionKey !== undefined) {
        item[trackedItem.tableConfig.versionKey] = trackedItem.version + 1;
    }
    return item;
}
exports.default = addVersionToUpdateItem;
