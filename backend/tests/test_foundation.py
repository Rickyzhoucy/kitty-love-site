from app.ids import new_id
from app.queue import procrastinate_app


def test_cuid2_ids_have_stable_shape_and_are_unique():
    ids = {new_id() for _ in range(100)}
    assert len(ids) == 100
    assert all(len(value) == 24 and value.isalnum() and value[0].isalpha() for value in ids)


def test_procrastinate_app_is_importable_without_connecting():
    assert procrastinate_app is not None
