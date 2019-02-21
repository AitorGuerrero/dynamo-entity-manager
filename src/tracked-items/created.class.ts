import {ITableConfig} from "../table-config.interface";
import TrackedItem from "./tracked-item.class";
import UpdatedTrackedItem from "./updated.class";

export default class CreatedTrackedItem<E> extends TrackedItem<E> {
	constructor(
		public readonly entity: E,
		public readonly tableConfig: ITableConfig<E>,
	) {
		super(
			entity,
			tableConfig,
			tableConfig.versionKey ? 0 : undefined,
		);
	}

	public toUpdate() {
		return new UpdatedTrackedItem(this.entity, this.tableConfig, this.version);
	}
}
