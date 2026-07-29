from cuid2 import Cuid

_generator = Cuid(length=24)


def new_id() -> str:
    """Generate a 24-character CUID2 identifier."""
    return _generator.generate()

