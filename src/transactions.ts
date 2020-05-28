import { Deferred, deferred, swallowError } from "./util";

export class Transactions<T> {
	private _seqNo: number = 0;
	private _transactions: Map<number, Deferred<T>> = new Map();

	public static readonly MAX_SEQ = 65536;

	async add(action: (seq: number) => void | Promise<void>): Promise<T> {
		const seq = this._nextSeq();
		const d = deferred<T>();
		const promise = d.promise.finally(() => this._transactions.delete(seq));
		this._transactions.set(seq, {
			promise,
			resolve: d.resolve,
			reject: d.reject,
		});
		try {
			await action(seq);
		} catch (err) {
			d.reject(err);
		}
		return promise;
	}

	/**
	 * Resolve pending transaction promise.
	 * Returns true when the given sequence number was actually found.
	 */
	resolve(seqNr: number, result: T): boolean {
		const transaction = this._transactions.get(seqNr);
		if (!transaction) {
			return false;
		}
		transaction.resolve(result);
		return true;
	}

	/**
	 * Reject pending transaction promise.
	 * Returns true when the given sequence number was actually found.
	 */
	reject(seqNr: number, err: Error): boolean {
		const transaction = this._transactions.get(seqNr);
		if (!transaction) {
			return false;
		}
		transaction.resolve(Promise.reject(err));
		return true;
	}

	/**
	 * Wait until all transactions have finished (either fulfilled or rejected).
	 */
	async join(): Promise<void> {
		// Keep waiting until all are done, even if some error out
		const inProgress = [...this._transactions.values()].map((t) =>
			t.promise.catch(swallowError)
		);
		await Promise.all(inProgress);
	}

	/**
	 * Reject all transactions with the given error.
	 */
	rejectAll(error: Error): void {
		this._transactions.forEach((t) => t.reject(error));
	}

	/**
	 * Compute next available sequence number.
	 * Throws an error when no sequence number is available (too many
	 * pending transactions).
	 */
	private _nextSeq(): number {
		let maxIteration = Transactions.MAX_SEQ;
		while (--maxIteration > 0 && this._transactions.has(this._seqNo)) {
			this._seqNo = (this._seqNo + 1) % Transactions.MAX_SEQ;
		}
		if (maxIteration === 0) {
			throw new Error("out of sequence numbers");
		}
		const result = this._seqNo;
		this._seqNo = (this._seqNo + 1) % Transactions.MAX_SEQ;
		return result;
	}
}
