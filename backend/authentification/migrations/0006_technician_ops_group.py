from django.db import migrations


def create_technician_ops_group(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.get_or_create(name="TECHNICIAN_OPS")


def delete_technician_ops_group(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.filter(name="TECHNICIAN_OPS").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("authentification", "0005_user_role_password_ops"),
    ]

    operations = [
        migrations.RunPython(create_technician_ops_group, delete_technician_ops_group),
    ]
