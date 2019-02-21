import {ITableConfig} from "../table-config.interface";
import TrackedItem from "./tracked-item.class";

export default class DeletedTrackedItem<E> extends TrackedItem<E> {
	constructor(
		public readonly entity: E,
		public readonly tableConfig: ITableConfig<E>,
		public readonly version?: number,
	) {
		super(
			entity,
			tableConfig,
			version,
		);
		this.initialStatus = JSON.stringify(entity);
	}
}
