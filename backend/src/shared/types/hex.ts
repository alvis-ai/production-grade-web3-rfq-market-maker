export function toFixedHex(input: string, hexLength: number): string {
  let hex = "";
  for (let index = 0; index < input.length; index += 1) {
    hex += input.charCodeAt(index).toString(16).padStart(2, "0");
  }

  return hex.padEnd(hexLength, "0").slice(0, hexLength);
}
