import base64
import io
import uuid

from PIL import Image, ImageOps
from sqlalchemy.orm import Session

from makan.config import get_settings
from makan.models import Photo

# Claude downsizes anything larger, so storing more only costs disk and upload time.
MAX_EDGE = 1568


class PhotoError(ValueError):
    pass


def save_photo(db: Session, user_id: int, data: bytes) -> Photo:
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
    except Exception as exc:
        raise PhotoError("That file isn't an image I can read (JPEG, PNG or WebP).") from exc
    img = img.convert("RGB")
    img.thumbnail((MAX_EDGE, MAX_EDGE))
    settings = get_settings()
    rel = f"{user_id}/{uuid.uuid4().hex}.jpg"
    path = settings.photo_dir / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=85)
    photo = Photo(user_id=user_id, path=rel, media_type="image/jpeg")
    db.add(photo)
    db.flush()
    return photo


def photo_bytes(photo: Photo) -> bytes:
    return (get_settings().photo_dir / photo.path).read_bytes()


def photo_b64(photo: Photo) -> str:
    return base64.standard_b64encode(photo_bytes(photo)).decode()
