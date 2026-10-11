// Only repair presentation syntax. The original reply remains the copy/history value.
function normalizeProse(source: string, inferBare = true): string {
    const normalized = source
        .replace(/\\\[([\s\S]*?)\\\]/g, (_, math: string) => `\n$$\n${math.trim()}\n$$\n`)
        .replace(/\\\(([^\n]*?)\\\)/g, (_, math: string) => `$${math.trim()}$`)
        .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, math: string) => `$$\n${math.trim()}\n$$`)
    if (!inferBare) return normalized
    return normalized.replace(/^[ \t]*([^\n]+)[ \t]*$/gm, (line: string) => {
            const math = line.trim()
            // A missing delimiter is only inferred for a whole formula line with a
            // strong TeX signal. Prose, currency, paths and ordinary identifiers stay text.
            if (!/\\(?:frac|dfrac|tfrac|lim|sum|int|sqrt)(?=[^a-zA-Z]|$)/.test(math) || /[$`]/.test(math)) return line
            if (/\\[()[\]]/.test(math)) return line
            const structure = math.replace(/\\text\{[^{}]*\}/g, '')
            if (!/^[\w\s\\{}()[\]^=+*/.,<>|!?:%&-]+$/.test(structure)) return line
            if (/[a-zA-Z]{2,}/.test(structure.replace(/\\[a-zA-Z]+/g, ''))) return line
            // TeX control words end at the first non-letter, including digits:
            // \to0 is as valid as \to 0, so a JS word boundary is inappropriate.
            if (/\\(?![a-zA-Z])/.test(structure)) return line
            const unwrapped = math.startsWith('[') && math.endsWith(']') ? math.slice(1, -1).trim() : math
            return `$$\n${unwrapped}\n$$`
        })
}

function normalizeOutsideInlineCode(source: string, inferBare: boolean): string {
    // Keep code spans and Markdown link destinations byte-for-byte. Incomplete code
    // spans during streaming stay literal rather than briefly becoming equations.
    const protectedSyntax = /(`+)[\s\S]*?\1(?!`)|`[^\n]*$|!?\[[^\]\n]*\]\([^\n]*?\)|\\\[[\s\S]*?\\\]|\\\([^\n]*?\\\)|\$\$[\s\S]*?\$\$|\$[^\n$]*?\$/gm
    let result = ''
    let cursor = 0
    for (const match of source.matchAll(protectedSyntax)) {
        const index = match.index!
        const protectedValue = match[0]
        const isMath = /^(?:\\[[(]|\$)/.test(protectedValue)
        result += normalizeProse(source.slice(cursor, index), inferBare) + (isMath ? normalizeProse(protectedValue, false) : protectedValue)
        cursor = index + match[0].length
    }
    return result + normalizeProse(source.slice(cursor), inferBare)
}

// Learning notes normalize explicit delimiters only; bare-formula repair remains
// specific to AI replies. Neither path changes the persisted source text.
export function normalizeMarkdownMath(source: string, inferBare = false): string {
    const lines = source.split('\n')
    let fence: { character: string; length: number } | undefined
    let prose = ''
    let result = ''
    const flush = () => {
        result += normalizeOutsideInlineCode(prose, inferBare)
        prose = ''
    }
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!
        const fullLine = line + (index < lines.length - 1 ? '\n' : '')
        // Recognize fences inside blockquotes too, so quoted code is never repaired.
        const marker = line.replace(/^(?: {0,3}> ?)+/, '').match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
        if (fence) {
            result += fullLine
            if (marker && marker[1]![0] === fence.character && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined
        } else if (marker || /^(?: {4}|\t)/.test(line)) {
            flush()
            result += fullLine
            if (marker) fence = { character: marker[1]![0]!, length: marker[1]!.length }
        } else {
            prose += fullLine
        }
    }
    flush()
    return result
}

export function normalizeAIResponseMath(source: string): string {
    return normalizeMarkdownMath(source, true)
}
