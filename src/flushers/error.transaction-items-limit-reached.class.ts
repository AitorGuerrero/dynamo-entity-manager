export default class TransactionItemsLimitReached extends Error {
	constructor(itemsAmount: number) {
		super(`Dynamo accepts a maximum of 10 items, ${itemsAmount} provided`);
		this.name = "transactionItemsLimitReached";
	}
}
