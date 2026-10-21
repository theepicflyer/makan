const MAX_EDGE = 1568;

/** Downscale to <=1568px and re-encode as JPEG. Also turns iPhone HEIC into something the server reads. */
export async function prepareImage(file: File): Promise<Blob> {
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.decoding = 'async';
		img.src = url;
		await img.decode();
		const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
		const w = Math.round(img.naturalWidth * scale);
		const h = Math.round(img.naturalHeight * scale);
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) return file;
		ctx.drawImage(img, 0, 0, w, h);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
		return blob ?? file;
	} catch {
		return file;
	} finally {
		URL.revokeObjectURL(url);
	}
}
