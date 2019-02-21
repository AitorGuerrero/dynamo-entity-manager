import {ITableConfig} from "../table-config.interface";

export default function addVersionToCreateItem<Entity>(item: any, tableConfig: ITableConfig<unknown>) {
	if (tableConfig.versionKey !== undefined) {
		item[tableConfig.versionKey] = 0;
	}

	return item;
}
