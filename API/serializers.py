from rest_framework import serializers
from Stops.models import Stop, StopType


class StopTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = StopType
        fields = ('id', 'name', 'code', 'sub_of')


class StopSerializer(serializers.ModelSerializer):
    stop_type = StopTypeSerializer(read_only=True)

    class Meta:
        model = Stop
        fields = ('id', 'name', 'common_name', 'long_name', 'atco_code', 'naptan_code', 'tiploc', 'crs', 'stop_type', 'active', 'lat', 'lon', 'lines', 'indicator', 'icon')
