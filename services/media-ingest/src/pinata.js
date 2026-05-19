const fetch = require('node-fetch')
const FormData = require('form-data')

const PINATA_JWT = process.env.PINATA_JWT

async function pinBufferToPinata(buffer, filename = 'file') {
  if (!PINATA_JWT) throw new Error('PINATA_JWT not set')
  const url = 'https://api.pinata.cloud/pinning/pinFileToIPFS'
  const form = new FormData()
  form.append('file', buffer, { filename })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      // form.getHeaders will be merged by node-fetch automatically when used with body
    },
    body: form
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Pinata pin failed: ${res.status} ${txt}`)
  }
  const json = await res.json()
  // returns { IpfsHash, PinSize, Timestamp }
  return json
}

module.exports = { pinBufferToPinata }
