"""Reproducible public-landing QR. Requires qrcode==8.2; no raster editing."""
from pathlib import Path
import json
import qrcode

url='https://erudoza.com/'
qr=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q,border=4)
qr.add_data(url)
qr.make(fit=True)
matrix=qr.get_matrix()
assert all(not cell for row in matrix[:4]+matrix[-4:] for cell in row)
assert all(not cell for row in matrix for cell in row[:4]+row[-4:])
result={'url':url,'generator':'python-qrcode 8.2','errorCorrection':'Q','quietZone':4,'version':qr.version,'modules':[[int(cell) for cell in row] for row in matrix]}
(Path(__file__).resolve().parent/'landing-qr.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
print(f'Generated version {qr.version} QR for {url}, including a four-module quiet zone.')
