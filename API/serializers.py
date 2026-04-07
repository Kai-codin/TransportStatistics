from rest_framework import serializers
from Stops.models import Stop, StopType
from main.models import Trains


class StopTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = StopType
        fields = ('id', 'name', 'code', 'sub_of')


class StopSerializer(serializers.ModelSerializer):
    stop_type = StopTypeSerializer(read_only=True)

    class Meta:
        model = Stop
        fields = ('id', 'name', 'common_name', 'long_name', 'atco_code', 'naptan_code', 'tiploc', 'crs', 'stop_type', 'active', 'lat', 'lon', 'lines', 'indicator', 'icon')


class FleetSerializer(serializers.ModelSerializer):
    livery = serializers.SerializerMethodField()

    class Meta:
        model = Trains
        fields = ("fleetnumber", "type", "livery")

    def get_livery(self, obj):
        return {
            "name": obj.livery_name,
            "css": obj.livery_css,
        }


class TrainFleetVehicleSerializer(serializers.ModelSerializer):
    fleet_number = serializers.CharField(source="fleetnumber")
    reg = serializers.SerializerMethodField()
    withdrawn = serializers.SerializerMethodField()
    vehicle_type = serializers.SerializerMethodField()
    livery = serializers.SerializerMethodField()
    operator = serializers.SerializerMethodField()

    class Meta:
        model = Trains
        fields = (
            "id",
            "fleet_number",
            "reg",
            "withdrawn",
            "vehicle_type",
            "livery",
            "operator",
        )

    def get_reg(self, obj):
        return None

    def get_withdrawn(self, obj):
        return False

    def get_vehicle_type(self, obj):
        return {"name": obj.type}

    def get_livery(self, obj):
        return {
            "name": obj.livery_name or "",
            "left": obj.livery_css or "",
            "right": "",
        }

    def get_operator(self, obj):
        if not obj.operator:
            return None
        return {
            "id": obj.operator_id,
            "name": obj.operator.name,
            "code": obj.operator.code,
        }
