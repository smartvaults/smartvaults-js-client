# Install dependencies

``` shell
npm install
```

## Build

``` shell
npx tsc
```

## Usage examples

### Install

```shell
npm install @smontero/smartvaults-js-client @smontero/smartvaults-wasm @smontero/nostr-ual --save
```

### Import modules

```javascript
import { NostrClient, SmartVaults, Contact } from '@smontero/smartvaults-js-client';
import { DirectPrivateKeyAuthenticator } from '@smontero/nostr-ual'
import {
  Wallet,
  miniscript_to_descriptor as miniScriptToDescriptor,
  can_finalize_psbt as canFinalizePsbt,
  get_trx_id as getTrxIdWasm,
  get_fee as getFeeWasm,
  MiniscriptBuilder,
  get_psbt_utxos as getPsbtUtxos,
  descriptor_to_miniscript as descriptorToMiniscript
} from '@smontero/smartvaults-wasm'
import { generatePrivateKey } from 'nostr-tools'
```

### Initializing `SmartVaults`

#### Parameters for Initialization:

1. `authenticator`: An instance of an Authenticator
2. `bitcoinUtil`: Utility functions related to Bitcoin transactions
3. `nostrClient`: An instance of NostrClient for interacting with Nostr relays

```javascript
const authenticator = new DirectPrivateKeyAuthenticator(generatePrivateKey())
const bitcoinUtil = {
        walletSyncTimeGap: 3, 
        toDescriptor: miniScriptToDescriptor,
        createWallet: (descriptor) => {
          return new Wallet(
            descriptor,
            'https://mempool.space/testnet/api',
            'testnet',
             15
          )
        },
        canFinalizePsbt: (psbts) => canFinalizePsbt(psbts),
        getTrxId: (trx) => getTrxIdWasm(trx),
        getFee: (psbt) => getFeeWasm(psbt),
        getPsbtUtxos: (psbt) => getPsbtUtxos(psbt),
        toMiniscript: (descriptor) => descriptorToMiniscript(descriptor)
}
const nostrClient = new NostrClient(['wss://test.relay.report'])
const smartVaults = new SmartVaults ({authenticator, bitcoinUtil, nostrClient})
```

### Example: Set profile and Contacts

```javascript
// Define the metadata object
const metadata = { name:'Bob', about:'Learning about Smart Vaults!'}
// Set profile
await smartVaults.setProfile(metadata)
const myPublicKey = authenticator.getPublicKey()
// Fetch profile
const myProfile = await smartVaults.getProfile(myPublicKey)
// Create another account to add as contact
const otherAuthenticator = new DirectPrivateKeyAuthenticator(generatePrivateKey())
const contactPubKey = otherAuthenticator.getPublicKey()
const contact = new Contact({publicKey: contactPubKey})
// Add contact
await smartVaults.upsertContacts(contact);
// Fetch contacts
const contacts = await smartVaults.getContacts()
// Fetch contacts including their metadata ( profile )
const contactsProfiles = await smartVaults.getContactProfiles()
```

### Example: Create an 2-of-2 Multisig Vault

```javascript
// For this example lets assume that we have created an account using one of the Smart Vaults apps ( iOs, Android or Desktop ).

// Get your Signers
const mySigners = await smartVaults.getOwnedSigners()
// For simplicity lets assume that we only have one signer
const mySigner = mySigners[0]
// Get your signer's Key
const mySignerKey = mySigner.key
// Get co-Signer's Key
const coSigner = await smartVaults.getSharedSigners()
const coSignerKey = coSigner[0].key
const keys = [mySignerKey, coSignerKey]
// Define the threshold
const threshold = 2
// Create the multisig miniscript
const miniscript = MiniscriptBuilder.multisig({threshold, keys})
// Define the other parameters
const name = 'My First Vault'
const description = "2 of 2 Multisig"
const nostrPublicKeys = [myPublicKey, contactPubKey]

// Create the vault
await smartVaults.savePolicy({ name, description, miniscript, nostrPublicKeys })
                                                    
```
