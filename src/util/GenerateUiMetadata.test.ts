import { toMiniscript, generateUiMetadata } from './GenerateUiMetadata';
jest.setTimeout(100000);

describe('generateUiMetadata', () => {
    let descOneOfTwo;
    let descTwoOfTwo;
    let descHold;
    let descInheritance;
    let descSocialRecovey;
    beforeAll(() => {
        descOneOfTwo = "tr([7c997e72/86'/1'/784923']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*,pk([5f2bef9b/86'/1'/784923']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*))#xrc02p3q"
        descTwoOfTwo = "tr(f3fc46a122697daeae57d3f2bb08d4dfe37df98423adcc0b65b6b0fc0242b2d1,multi_a(2,[5f2bef9b/86'/1'/784923']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*,[7c997e72/86'/1'/784923']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*))#yrnlu28f"
        descHold = "tr(c67c515bb4a81bde965ab9a808cf0afdb1e5657e55224ed2bb1a3df94ff322da,and_v(v:pk([7c997e72/86'/1'/784923']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*),after(10000)))#0tl9q7kp"
        descInheritance = "tr([7c997e72/86'/1'/784923']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*,and_v(v:multi_a(2,[87131a00/86'/1'/784923']tpubDDEaK5JwGiGDTRkML9YKh8AF4rHPhkpnXzVjVMDBtzayJpnsWKeiFPxtiyYeGHQj8pnjsei7N98winwZ3ivGoVVKArZVMsEYGig73XVqbSX/0/*,[5f2bef9b/86'/1'/784923']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*),older(6)))#9ejpy98q"
        descSocialRecovey = "tr([7c997e72/86'/1'/784923']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*,and_v(v:multi_a(1,[5f2bef9b/86'/1'/784923']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*,[87131a00/86'/1'/784923']tpubDDEaK5JwGiGDTRkML9YKh8AF4rHPhkpnXzVjVMDBtzayJpnsWKeiFPxtiyYeGHQj8pnjsei7N98winwZ3ivGoVVKArZVMsEYGig73XVqbSX/0/*),after(10000)))#8cmhwt8u"
    }
    )

    describe('toMiniscript', () => {

        it('toMiniscript works', async () => {


            const miniscriptOneOfTwo = "thresh(1,pk([7c997e72/86'/1'/784923']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*),pk([5f2bef9b/86'/1'/784923']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*))"
            const miniscriptTwoOfTwO = "thresh(2,pk([5f2bef9b/86'/1'/784923']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*),pk([7c997e72/86'/1'/784923']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*))"
            const miniscriptHold = "and(pk([7c997e72/86'/1'/784923']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*),after(10000))"
            const miniscriptInheritance = "or(pk([7c997e72/86'/1'/784923']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*),and(thresh(2,pk([87131a00/86'/1'/784923']tpubDDEaK5JwGiGDTRkML9YKh8AF4rHPhkpnXzVjVMDBtzayJpnsWKeiFPxtiyYeGHQj8pnjsei7N98winwZ3ivGoVVKArZVMsEYGig73XVqbSX/0/*),pk([5f2bef9b/86'/1'/784923']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*)),older(6)))"
            const miniscriptSocialRecovery = "or(pk([7c997e72/86'/1'/784923']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*),and(thresh(1,pk([5f2bef9b/86'/1'/784923']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*),pk([87131a00/86'/1'/784923']tpubDDEaK5JwGiGDTRkML9YKh8AF4rHPhkpnXzVjVMDBtzayJpnsWKeiFPxtiyYeGHQj8pnjsei7N98winwZ3ivGoVVKArZVMsEYGig73XVqbSX/0/*)),after(10000)))"

            expect(toMiniscript(descOneOfTwo)).toEqual(miniscriptOneOfTwo)
            expect(toMiniscript(descTwoOfTwo)).toEqual(miniscriptTwoOfTwO)
            expect(toMiniscript(descHold)).toEqual(miniscriptHold)
            expect(toMiniscript(descInheritance)).toEqual(miniscriptInheritance)
            expect(toMiniscript(descSocialRecovey)).toEqual(miniscriptSocialRecovery)
        }
        )

        it('generateUiMetadata works', async () => {
            const createdAt = new Date();
            const hold = '{ "json": { "blocks": { "languageVersion": 0, "blocks": [ { "type": "begin", "id": "mockId", "x": 293, "y": 10, "fields": { "SPACE": " " }, "next": { "block": { "type": "and", "id": "mockId", "fields": { "A_weight": 1, "SPACE": " ", "B_weight": 1 }, "inputs": { "A": { "block": { "type": "pk", "id": "mockId", "inputs": { "Key": { "block": { "type": "my_key", "id": "mockId", "fields": { "Key": "[7c997e72/86\'/1\'/784923\']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/\*" } } } } } }, "B": { "block": { "type": "after", "id": "mockId", "fields": { "value": 10000 } } } } } } } ] } }, "policyCode": "and(pk([7c997e72/86\'/1\'/784923\']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*),after(10000))", "keys": [] }'
            const holdMetadata = JSON.stringify(generateUiMetadata(descHold, [{ "fingerprint": "7c997e72", "descriptor": "", "description": "", "name": "", "t": "", "id": "", createdAt }])).replace(/"id":\s*"[^"]*"/g, '"id":"mockId"');
            expect(holdMetadata).toEqual(JSON.stringify(JSON.parse(hold)))
            const oneOfTwo = '{ "json": { "blocks": { "languageVersion": 0, "blocks": [ { "type": "begin", "id": "s7yittlg8v", "x": 293, "y": 10, "fields": { "SPACE": " " }, "next": { "block": { "type": "thresh", "id": "vvytr5c3rh", "fields": { "Threshold": 1, "SPACE": " " }, "inputs": { "Statements": { "block": { "type": "pk", "id": "7bhl4cw35v", "inputs": { "Key": { "block": { "type": "my_key", "id": "x5eqkjacccs", "fields": { "Key": "[7c997e72/86\'/1\'/784923\']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/\*" } } } }, "next": { "block": { "type": "pk", "id": "n3caw4glrt", "inputs": { "Key": { "block": { "type": "key", "id": "ypv6wriijyf", "fields": { "Key": "[5f2bef9b/86\'/1\'/784923\']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/\*" } } } } } } } } } } } } ] } }, "policyCode": "thresh(1,pk([7c997e72/86\'/1\'/784923\']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*),pk([5f2bef9b/86\'/1\'/784923\']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*))", "keys": [] }'.replace(/"id":\s*"[^"]*"/g, '"id":"mockId"')
            const oneOfTwoMetadata = JSON.stringify(generateUiMetadata(descOneOfTwo, [{ "fingerprint": "7c997e72", "descriptor": "", "description": "", "name": "", "t": "", "id": "", createdAt }])).replace(/"id":\s*"[^"]*"/g, '"id":"mockId"');
            expect(oneOfTwoMetadata).toEqual(JSON.stringify(JSON.parse(oneOfTwo)))
            const twoOfTwo = '{ "json": { "blocks": { "languageVersion": 0, "blocks": [ { "type": "begin", "id": "jed6xn4lt28", "x": 293, "y": 10, "fields": { "SPACE": " " }, "next": { "block": { "type": "thresh", "id": "2m0554kaiwk", "fields": { "Threshold": 2, "SPACE": " " }, "inputs": { "Statements": { "block": { "type": "pk", "id": "d3b7y28xujn", "inputs": { "Key": { "block": { "type": "key", "id": "5g9eehic4ph", "fields": { "Key": "[5f2bef9b/86\'/1\'/784923\']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/\*" } } } }, "next": { "block": { "type": "pk", "id": "of3tky9ovi", "inputs": { "Key": { "block": { "type": "my_key", "id": "2vv256pyy8x", "fields": { "Key": "[7c997e72/86\'/1\'/784923\']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/\*" } } } } } } } } } } } } ] } }, "policyCode": "thresh(2,pk([5f2bef9b/86\'/1\'/784923\']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*),pk([7c997e72/86\'/1\'/784923\']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/\*))", "keys": [] }'.replace(/"id":\s*"[^"]*"/g, '"id":"mockId"')
            const twoOfTwoMetadata = JSON.stringify(generateUiMetadata(descTwoOfTwo, [{ "fingerprint": "7c997e72", "descriptor": "", "description": "", "name": "", "t": "", "id": "", createdAt }])).replace(/"id":\s*"[^"]*"/g, '"id":"mockId"');
            expect(twoOfTwoMetadata).toEqual(JSON.stringify(JSON.parse(twoOfTwo)))
            const inheritance = '{ "json": { "blocks": { "languageVersion": 0, "blocks": [ { "type": "begin", "id": "f70q325d1jl", "x": 293, "y": 10, "fields": { "SPACE": " " }, "next": { "block": { "type": "or", "id": "z6jly71axno", "fields": { "A_weight": 1, "SPACE": " ", "B_weight": 1 }, "inputs": { "A": { "block": { "type": "pk", "id": "ibjwu82tjhm", "inputs": { "Key": { "block": { "type": "my_key", "id": "ppwdrwc451t", "fields": { "Key": "[7c997e72/86\'/1\'/784923\']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*" } } } } } }, "B": { "block": { "type": "and", "id": "g3o6rzw1p1", "fields": { "A_weight": 1, "SPACE": " ", "B_weight": 1 }, "inputs": { "A": { "block": { "type": "thresh", "id": "71ld3xmgffe", "fields": { "Threshold": 2, "SPACE": " " }, "inputs": { "Statements": { "block": { "type": "pk", "id": "hyrkxy7g9cm", "inputs": { "Key": { "block": { "type": "key", "id": "rcv6ywo5dy9", "fields": { "Key": "[87131a00/86\'/1\'/784923\']tpubDDEaK5JwGiGDTRkML9YKh8AF4rHPhkpnXzVjVMDBtzayJpnsWKeiFPxtiyYeGHQj8pnjsei7N98winwZ3ivGoVVKArZVMsEYGig73XVqbSX/0/*" } } } }, "next": { "block": { "type": "pk", "id": "eypp7z1pmf7", "inputs": { "Key": { "block": { "type": "key", "id": "9zxkb6ssglf", "fields": { "Key": "[5f2bef9b/86\'/1\'/784923\']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/\*" } } } } } } } } } } }, "B": { "block": { "type": "older", "id": "6e8leyn37sd", "fields": { "value": 6 } } } } } } } } } } ] } }, "policyCode": "or(pk([7c997e72/86\'/1\'/784923\']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*),and(thresh(2,pk([87131a00/86\'/1\'/784923\']tpubDDEaK5JwGiGDTRkML9YKh8AF4rHPhkpnXzVjVMDBtzayJpnsWKeiFPxtiyYeGHQj8pnjsei7N98winwZ3ivGoVVKArZVMsEYGig73XVqbSX/0/*),pk([5f2bef9b/86\'/1\'/784923\']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*)),older(6)))", "keys": [] }'.replace(/"id":\s*"[^"]*"/g, '"id":"mockId"')
            const inheritanceMetadata = JSON.stringify(generateUiMetadata(descInheritance, [{ "fingerprint": "7c997e72", "descriptor": "", "description": "", "name": "", "t": "", "id": "", createdAt }])).replace(/"id":\s*"[^"]*"/g, '"id":"mockId"');
            expect(inheritanceMetadata).toEqual(JSON.stringify(JSON.parse(inheritance)))
            const socialRecovery = '{ "json": { "blocks": { "languageVersion": 0, "blocks": [ { "type": "begin", "id": "ez2tax8epf", "x": 293, "y": 10, "fields": { "SPACE": " " }, "next": { "block": { "type": "or", "id": "1n0i2747qy1", "fields": { "A_weight": 1, "SPACE": " ", "B_weight": 1 }, "inputs": { "A": { "block": { "type": "pk", "id": "6zglbbom8pu", "inputs": { "Key": { "block": { "type": "my_key", "id": "la22i4e2o38", "fields": { "Key": "[7c997e72/86\'/1\'/784923\']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*" } } } } } }, "B": { "block": { "type": "and", "id": "dgcis2kjd8m", "fields": { "A_weight": 1, "SPACE": " ", "B_weight": 1 }, "inputs": { "A": { "block": { "type": "thresh", "id": "sm1y6yao1s9", "fields": { "Threshold": 1, "SPACE": " " }, "inputs": { "Statements": { "block": { "type": "pk", "id": "lk4iqy7q41m", "inputs": { "Key": { "block": { "type": "key", "id": "uf1foalmn6", "fields": { "Key": "[5f2bef9b/86\'/1\'/784923\']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*" } } } }, "next": { "block": { "type": "pk", "id": "ouxaixibo8", "inputs": { "Key": { "block": { "type": "key", "id": "tbzawfbrp5", "fields": { "Key": "[87131a00/86\'/1\'/784923\']tpubDDEaK5JwGiGDTRkML9YKh8AF4rHPhkpnXzVjVMDBtzayJpnsWKeiFPxtiyYeGHQj8pnjsei7N98winwZ3ivGoVVKArZVMsEYGig73XVqbSX/0/*" } } } } } } } } } } }, "B": { "block": { "type": "after", "id": "7spcy57t89w", "fields": { "value": 10000 } } } } } } } } } } ] } }, "policyCode": "or(pk([7c997e72/86\'/1\'/784923\']tpubDDTGvzeqbVUeCApGdB84rXDoQeqvZWmeLyNcUVHs34e913aCNBmj3tsGdXTt5Sn3o7RWcBsRsjUyoSB2ih2krVxe64FjX3C52yzEh7U5Qoh/0/*),and(thresh(1,pk([5f2bef9b/86\'/1\'/784923\']tpubDDtLZM2VKqgSFAWQ4omDqJHHoQWQ151tpN7V8ZyEEKkNJhZpUbyDapfYK5grw2gpwhsyRudSyX9XeU8h3oSvDjnRxLPvYhBqQJTYr2hSmzi/0/*),pk([87131a00/86\'/1\'/784923\']tpubDDEaK5JwGiGDTRkML9YKh8AF4rHPhkpnXzVjVMDBtzayJpnsWKeiFPxtiyYeGHQj8pnjsei7N98winwZ3ivGoVVKArZVMsEYGig73XVqbSX/0/*)),after(10000)))", "keys": [] }'.replace(/"id":\s*"[^"]*"/g, '"id":"mockId"')
            const socialRecoveryMetadata = JSON.stringify(generateUiMetadata(descSocialRecovey, [{ "fingerprint": "7c997e72", "descriptor": "", "description": "", "name": "", "t": "", "id": "", createdAt }])).replace(/"id":\s*"[^"]*"/g, '"id":"mockId"');
            expect(socialRecoveryMetadata).toEqual(JSON.stringify(JSON.parse(socialRecovery)))
        }
        )
    })
})