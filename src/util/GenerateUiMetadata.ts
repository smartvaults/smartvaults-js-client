import { type PublishedOwnedSigner } from "../types";

type Block = {
    type: string;
    id: string;
    x?: number;
    y?: number;
    fields?: any;
    inputs?: any;
    next?: any;
};

export type Key = {
    pubkey: string;
    fingerprint: string;
    descriptor: string;
}

export type UIMetadata = {
    json: any,
    policyCode: string,
    keys: Array<Key>
};

function generateId(): string {
    return Math.random().toString(36).substring(2, 15);
}

function splitArgs(exp: string): string[] {
    let args: string[] = [];
    let start = 0;
    let depth = 0;

    // Check for balanced parentheses
    let openCount = 0;
    let closeCount = 0;
    for (let char of exp) {
        if (char === '(') openCount++;
        if (char === ')') closeCount++;
    }

    if (openCount !== closeCount) {
        throw new Error("Unbalanced parentheses in expression");
    }

    for (let i = 0; i < exp.length; i++) {
        if (exp[i] === '(') {
            depth++;
        } else if (exp[i] === ')') {
            depth--;
        } else if (exp[i] === ',' && depth === 0) {
            args.push(exp.substring(start, i).trim());
            start = i + 1;
        }
    }

    args.push(exp.substring(start).trim());

    return args;
}

function extractFingerprint(input: string): string | null {
    const match = input.match(/\[(\w+)/);

    if (match && match[1]) {
        return match[1];
    }
    return null;
}

function parseExpression(exp: string, ownedSigners: Array<PublishedOwnedSigner>, keys: any[]): [Block, any[]] {
    try {
        if (exp.startsWith("pk(")) {
            const key: string = exp.split("pk(")[1].slice(0, -1);
            const fingerprint = extractFingerprint(key);
            keys.push({ fingerprint, descriptor: key });
            return [{
                type: "pk",
                id: generateId(),
                inputs: {
                    "Key": {
                        block: {
                            type: ownedSigners.some(({ fingerprint }) => key.includes(fingerprint)) ? "my_key" : "key",
                            id: generateId(),
                            fields: {
                                "Key": key
                            }
                        }
                    }
                }
            }, keys];
        } else if (exp.startsWith("thresh(")) {
            const keyMatch = exp.match(/\d+/)
            const threshold = parseInt(keyMatch ? keyMatch[0] : "");
            const content = splitArgs(exp.slice("thresh(".length, -1));

            const statements = content.slice(1); // Omit the threshold value
            let nextBlock: Block | null = null;
            let currentBlock: Block | null = null;

            for (const statement of statements) {
                const block = parseExpression(statement, ownedSigners, keys)[0];
                if (nextBlock) {
                    nextBlock.next = { block };
                }
                if (!currentBlock) {
                    currentBlock = block;
                }
                nextBlock = block;
            }

            return [{
                type: "thresh",
                id: generateId(),
                fields: {
                    "Threshold": threshold,
                    "SPACE": " "
                },
                inputs: {
                    "Statements": {
                        block: currentBlock
                    }
                }
            }, keys];
        } else if (exp.startsWith("older(")) {
            const value = parseInt(exp.slice("older(".length, -1));
            return [{
                type: "older",
                id: generateId(),
                fields: {
                    "value": value
                }
            }, keys];
        } else if (exp.startsWith("after(")) {
            const value = parseInt(exp.slice("after(".length, -1));
            return [{
                type: "after",
                id: generateId(),
                fields: {
                    "value": value
                }
            }, keys];
        }
        else if (exp.startsWith("or(") || exp.startsWith("and(")) {
            const type = exp.startsWith("or(") ? "or" : "and";
            let content = splitArgs(exp.slice(type.length + 1, -1));
            if (content[0].startsWith("pk(") && !content[0].startsWith("pk([")) {
                return parseExpression(content[1], ownedSigners, keys);
            }
            const maybeAllPublicKeys = content.every(
                c =>
                    c.startsWith("pk(") ||
                    (c.startsWith(type) && splitArgs(c.slice(type.length + 1, -1)).every(
                        c2 => c2.startsWith("pk(")
                    )
                    )
            );
            if (maybeAllPublicKeys && type === "or") {
                const maybeNeedsFlatten = content.indexOf(content.find(c => c.startsWith(type)) || "");
                if (maybeNeedsFlatten !== -1) {
                    content[maybeNeedsFlatten] = content[maybeNeedsFlatten].slice(type.length + 1, -1);
                }
                return parseExpression(`thresh(1,${content.join(',')})`, ownedSigners, keys);
            }
            if (maybeAllPublicKeys && type === "and") {
                const maybeNeedsFlatten = content.indexOf(content.find(c => c.startsWith(type)) || "");
                if (maybeNeedsFlatten !== -1) {
                    content[maybeNeedsFlatten] = content[maybeNeedsFlatten].slice(type.length + 1, -1);
                }
                return parseExpression(`thresh(${content.length},${content.join(',')})`, ownedSigners, keys);
            }
            if (content.length > 2) {
                const threshold = type === "or" ? 1 : content.length - 1;
                const lastCondition = content.pop()!;
                content[0] = `thresh(${threshold},${content.join(',')})`;
                content[1] = lastCondition;
            }
            const weightPattern = /(\d+)@/g;
            let weights: number[] = [];
            let match;
            while ((match = weightPattern.exec(content.join(','))) !== null) {
                weights.push(parseInt(match[1]));
            }

            const a_weight = weights.length > 0 ? weights[0] : 1;
            const b_weight = weights.length > 1 ? weights[1] : 1;


            return [{
                type: type,
                id: generateId(),
                fields: {
                    "A_weight": a_weight,
                    "SPACE": " ",
                    "B_weight": b_weight,
                },
                inputs: {
                    "A": {
                        block: parseExpression(content[0].replace(/\d+@/g, ""), ownedSigners, keys)[0]
                    },
                    "B": {
                        block: parseExpression(content[1].replace(/\d+@/g, ""), ownedSigners, keys)[0]
                    }
                }
            }, keys];
        } else throw new Error(`Unknown miniscript expression: ${exp}`);
    }
    catch (e) {
        throw new Error(`Error parsing miniscript: ${e}`);
    }
}

export function generateBlocklyJson(miniscript: string, ownedSigners: Array<PublishedOwnedSigner>): any {
    let json: any;
    let keys: any[] = [];
    try {
        const [initialBlock, key] = parseExpression(miniscript, ownedSigners, []);

        const result: { blocks: { languageVersion: number, blocks: Block[] } } = {
            blocks: {
                languageVersion: 0,
                blocks: [{
                    type: "begin",
                    id: generateId(),
                    x: 293,
                    y: 10,
                    fields: { "SPACE": " " },
                    next: {
                        block: initialBlock
                    }
                }]
            }
        };
        json = JSON.parse(JSON.stringify(result, null, 4));
        keys = key
    } catch (e) {
        throw new Error(`Error generating Blockly's JSON ${e}`);
    }
    return [json, keys];
}

export function generateUiMetadata(descriptor: string, ownedSigners: Array<PublishedOwnedSigner>, toMiniscript: (descriptor: string) => string): UIMetadata {
    let policyCode: string;
    try {
        policyCode = toMiniscript(descriptor);
    } catch (e) {
        throw new Error(`Error transforming descriptor: ${e}`);
    }
    const [jsonContent, keys] = generateBlocklyJson(policyCode, ownedSigners);
    return {
        json: jsonContent,
        policyCode: policyCode,
        keys,
    };
}