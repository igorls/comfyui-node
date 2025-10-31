export function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
export function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
export function randomSeed() {
    return Math.floor(Math.random() * 2147483647);
}
//# sourceMappingURL=test-helpers.js.map