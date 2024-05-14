export function logArray(description: string, array: unknown[]): void {
	console.log(description, array.length, array);
}

export function logNonEmptyArray(description: string, array: unknown[]): void {
	if (array.length > 0) logArray(description, array);
}
