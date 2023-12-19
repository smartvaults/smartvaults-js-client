
export function readFile(
    readAs: 'ArrayBuffer' | 'Text' = 'ArrayBuffer',
    fileExtensions: string[] = ['.psbt']
): Promise<ArrayBuffer | string> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        if (fileExtensions.length > 0) {
            input.accept = fileExtensions.join(',');
        }

        input.addEventListener('change', (event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (file) {
                const reader = new FileReader();

                reader.onload = (e) => {
                    resolve(e.target?.result as ArrayBuffer | string);
                };

                reader.onerror = () => {
                    reject(new Error("Error reading file"));
                };

                if (readAs === 'ArrayBuffer') {
                    reader.readAsArrayBuffer(file);
                } else {
                    reader.readAsText(file);
                }
            } else {
                reject(new Error("File selection canceled"));
            }
        });

        input.click();
    });
}

export function saveFile(
    fileName: string,
    fileContent: ArrayBuffer | string,
    saveAs: 'ArrayBuffer' | 'Text' = 'ArrayBuffer',
    fileExtension: string = '.psbt'
): void {
    let blob: Blob;

    if (saveAs === 'ArrayBuffer' && fileContent instanceof ArrayBuffer) {
        blob = new Blob([fileContent], { type: 'application/octet-stream' });
    } else if (typeof fileContent === 'string') {
        blob = new Blob([fileContent], { type: 'text/csv;charset=utf-8,' });
    } else {
        throw new Error('Invalid fileContent type. Expected ArrayBuffer or string.');
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName + fileExtension;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

export function generateCsv(
    data: any[],
    headers: string[],
    delimiter: string = ','
): string {
    const headerRow = headers.join(delimiter) + '\n';
    const dataRows = data.map(row => {
        return headers.map(header => {
            return row[header];
        }).join(delimiter);
    }).join('\n');

    return headerRow + dataRows;
}