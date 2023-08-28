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

type Keys = {
    pubkey: string;
    fingerprint: string;
    descriptor: string;
}

export type UIMetadata = {
    json: any,
    policyCode: string,
    keys: Array<Keys>
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

function parseExpression(exp: string, ownedSigners: Array<PublishedOwnedSigner>): Block {
    try {
        if (exp.startsWith("pk(")) {
            const keyMatch = exp.match(/\[.*?\//);
            const keyContent = keyMatch ? keyMatch[0].slice(0, -1) : "";
            return {
                type: "pk",
                id: generateId(),
                inputs: {
                    "Key": {
                        block: {
                            type: ownedSigners.some(({ fingerprint }) => keyContent.includes(fingerprint)) ? "my_key" : "key",
                            id: generateId(),
                            fields: {
                                "Key": exp.split("pk(")[1].slice(0, -1)
                            }
                        }
                    }
                }
            };
        } else if (exp.startsWith("thresh(")) {
            const keyMatch = exp.match(/\d+/)
            const threshold = parseInt(keyMatch ? keyMatch[0] : "");
            const content = splitArgs(exp.slice("thresh(".length, -1));

            const statements = content.slice(1); // Omit the threshold value
            let nextBlock: Block | null = null;
            let currentBlock: Block | null = null;

            for (const statement of statements) {
                const block = parseExpression(statement, ownedSigners);
                if (nextBlock) {
                    nextBlock.next = { block };
                }
                if (!currentBlock) {
                    currentBlock = block;
                }
                nextBlock = block;
            }

            return {
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
            };
        } else if (exp.startsWith("older(")) {
            const value = parseInt(exp.slice("older(".length, -1));
            return {
                type: "older",
                id: generateId(),
                fields: {
                    "value": value
                }
            };
        } else if (exp.startsWith("after(")) {
            const value = parseInt(exp.slice("after(".length, -1));
            return {
                type: "after",
                id: generateId(),
                fields: {
                    "value": value
                }
            };
        }
        else if (exp.startsWith("or(") || exp.startsWith("and(")) {
            const type = exp.startsWith("or(") ? "or" : "and";
            const content = splitArgs(exp.slice(type.length + 1, -1));


            return {
                type: type,
                id: generateId(),
                fields: {
                    "A_weight": 1,
                    "SPACE": " ",
                    "B_weight": 1
                },
                inputs: {
                    "A": {
                        block: parseExpression(content[0], ownedSigners)
                    },
                    "B": {
                        block: parseExpression(content[1], ownedSigners)
                    }
                }
            };
        } else throw new Error(`Unknown miniscript expression: ${exp}`);
    }
    catch (e) {
        throw new Error(`Error parsing miniscript: ${e}`);
    }
}

export function generateBlocklyJson(miniscript: string, ownedSigners: Array<PublishedOwnedSigner>): string {
    let json: any;
    try {
        const initialBlock = parseExpression(miniscript, ownedSigners);

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
    } catch (e) {
        throw new Error(`Error generating Blockly's JSON ${e}`);
    }
    return json
}

export function toMiniscript(descriptor: string): string {
    const trRegex = /^tr\(([^,]+),(.+)\)(?:#.*)?$/;
    const match = descriptor.match(trRegex);

    if (!match) throw new Error("Invalid descriptor");

    const primaryKey = match[1];
    let trContent = match[2];
    let prevContent = "";

    try {
        while (prevContent !== trContent) {
            prevContent = trContent;

            if (trContent.includes('multi_a(')) {
                trContent = transformMultiA(trContent);
            }
            if (trContent.includes('and_v(v:pk(')) {
                trContent = trContent.replace('v:pk(', 'pk(').replace('and_v(', 'and(');
            }
            if (trContent.includes('and_v(')) {
                trContent = transformAndV(trContent);
            }
        }
        if (primaryKey.startsWith('[')) {
            trContent = transformNested(trContent, primaryKey);
        } else {
            trContent = trContent.replace(new RegExp(primaryKey, 'g'), `pk(${primaryKey})`);
        }
    } catch (e) {
        throw new Error(`Error transforming descriptor: ${e}`);
    }
    return trContent;
}

function flattenContent(content: string): string {
    while (content.includes('{') && content.includes('}')) {
        const nestedStart = content.lastIndexOf('{');
        const nestedEnd = content.indexOf('}', nestedStart);
        const beforeNested = content.slice(0, nestedStart);
        const nestedContent = content.slice(nestedStart + 1, nestedEnd);
        const afterNested = content.slice(nestedEnd + 1);
        content = `${beforeNested}${nestedContent}${afterNested}`;
    }
    return content;
}

function transformNested(content: string, primaryKey: string): string {
    content = flattenContent(content);

    const pkRegex = /pk\(([^)]+)\)/g;
    let match;
    const allPks: string[] = [];
    while ((match = pkRegex.exec(content)) !== null) {
        allPks.push(match[1]);
    }

    if (content.startsWith('pk(')) {
        return `thresh(1,pk(${primaryKey}),${allPks.map(pk => `pk(${pk})`).join(',')})`;
    } else if (content.includes('pk(') && !content.includes('and(') && !content.includes('or(')) {
        return `thresh(1,pk(${primaryKey}),${allPks.map(pk => `pk(${pk})`).join(',')})`;
    } else {
        return `or(pk(${primaryKey}),${content})`;
    }
}


function transformMultiA(content: string): string {
    return content.replace(/multi_a\((\d+),([^)]+)\)/g, (_, threshold, keys) => {
        const keyList = keys.split(',').map(k => 'pk(' + k.trim() + ')').join(',');
        return `thresh(${threshold},${keyList})`;
    });
}

function transformAndV(content: string): string {
    return content.replace(/and_v\((v:)?([^,]+),([^)]+)\)/g, (_, __, firstCondition, secondCondition) => {
        if (firstCondition.includes('multi_a(')) {
            firstCondition = transformMultiA(firstCondition);
        }
        return `and(${firstCondition},${secondCondition})`;
    });
}


export function generateUiMetadata(inputString: string, ownedSigners: Array<PublishedOwnedSigner>): UIMetadata {
    const policyCode = toMiniscript(inputString);
    const jsonContent = generateBlocklyJson(policyCode, ownedSigners);
    return {
        json: jsonContent,
        policyCode: policyCode,
        keys: []
    };
}