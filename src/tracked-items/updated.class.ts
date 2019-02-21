import {ITableConfig} from "../table-config.interface";
import TrackedItem from "./tracked-item.class";

export default class UpdatedTrackedItem<E> extends TrackedItem<E> {
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
		this.setState();
	}

	public setState() {
		this.initialStatus = JSON.stringify(this.entity);
	}

	public get hasChanged() {
		return JSON.stringify(this.entity) !== this.initialStatus;
	}
}
