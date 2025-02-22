<script setup>
import { computed, inject, ref, onMounted, onUnmounted } from 'vue';

import { currentEpochSecond, parseJSONDate } from "assetlink-plugin-api";

import { useRouter } from 'vue-router'

const router = useRouter();

const props = defineProps({
  asset: {
    type: Object,
    required: true,
  },
});

const assetLink = inject('assetLink');

const loadingLocationOccupants = ref(false);
const locationOccupants = ref([]);

const locationOccupantNodes = computed(() => {
  return locationOccupants.value.map(occupant => {
    return {
      id: occupant.id,
      occupant,
      selectable: true,
    };
  });
});

const selectedOccupant = ref(null);

const resolveCurrentLocationOccupants = async () => {
  loadingLocationOccupants.value = true;

  const logTypes = (await assetLink.getLogTypes()).map(t => t.attributes.drupal_internal__id);

  const populateLocationOccupantsFromLatestMovementLogs = async (entitySource, entitySourceCache) => {

    const results = await entitySource.query(q => logTypes.map(logType => {
      return q.findRecords(`log--${logType}`)
        .filter({ attribute: 'is_movement', op: 'equal', value: true })
        .filter({ attribute: 'status', op: 'equal', value: 'done' })
        .filter({ attribute: 'timestamp', op: '<=', value: currentEpochSecond() })
        .filter({
          relation: 'location.id',
          op: 'some',
          records: [{ type: props.asset.type, id: props.asset.id }]
        })
        .sort('-timestamp');
    }), {
      sources: {
        remote: {
          include: ['asset']
        }
      }
    });

    const logs = results.flatMap(l => l);

    const allPossibleOccupants = logs.flatMap(log => log.relationships?.asset?.data);

    const movementLogQueryPromises = [];

    // Query the possible members' logs in chunks of 50 to avoid calling the server with too
    // long of a query URL
    const maxOccupantsToQuery = 50;
    for (let i = 0; i < allPossibleOccupants.length; i += maxOccupantsToQuery) {
      const chunkOfPossibleOccupants = allPossibleOccupants.slice(i, i + maxOccupantsToQuery);

      movementLogQueryPromises.push(entitySource.query(q => logTypes.map(logType => {
        const logTypeName = `log--${logType}`;
        return q.findRecords(logTypeName)
          .filter({ attribute: 'is_movement', op: 'equal', value: true })
          .filter({ attribute: 'status', op: 'equal', value: 'done' })
          .filter({ attribute: 'timestamp', op: '<=', value: currentEpochSecond() })
          .filter({
            relation: 'asset.id',
            op: 'some',
            records: chunkOfPossibleOccupants
          })
          .sort('-timestamp');
      })));
    }

    const movementLogResults = await Promise.all(movementLogQueryPromises);

    const logsForAllPossibleOccupants = Object.values(movementLogResults.flatMap(l => l).flatMap(l => l).reduce(function(byId, log) {
      byId[log.id] = log;
      return byId;
    }, {}));

    const currentOccupants = allPossibleOccupants.flatMap(possibleOccupant => {
          const latestLog = logsForAllPossibleOccupants
              .filter(log => log.relationships.asset.data.find(a => a.id === possibleOccupant.id))
              .reduce((logA, logB) => parseJSONDate(logA.attributes.timestamp) > parseJSONDate(logB.attributes.timestamp) ? logA : logB);

          if (!latestLog.relationships.location.data.find(l => l.id === props.asset.id)) {
            return [];
          }

          const currentOccupant = entitySourceCache.query((q) => q.findRecord({ type: possibleOccupant.type, id: possibleOccupant.id }));

          if (!currentOccupant || currentOccupant.attributes.status === 'archived') {
            return [];
          }

          return [{ latestLogDate: parseJSONDate(latestLog.attributes.timestamp), occupant: currentOccupant}];
      })
      .sort((a, b) => (b.latestLogDate - a.latestLogDate) || parseJSONDate(b.occupant.attributes.created) - parseJSONDate(a.occupant.attributes.created))
      .map(m => m.occupant);

    const uniqueCurrentOccupants = {}
    currentOccupants.forEach(o => uniqueCurrentOccupants[o.id] = o);

    locationOccupants.value = Object.values(uniqueCurrentOccupants);
  }

  await populateLocationOccupantsFromLatestMovementLogs(assetLink.entitySource.cache, assetLink.entitySource.cache);

  await populateLocationOccupantsFromLatestMovementLogs(assetLink.entitySource, assetLink.entitySource.cache);

  loadingLocationOccupants.value = false;
};

const onAssetLogsChanged = ({ assetType, assetId }) => {
  if (
    props.asset.type === assetType &&
    props.asset.id === assetId
  ) {
    resolveCurrentLocationOccupants();
  }
};

let unsubber;
onMounted(() => {
  resolveCurrentLocationOccupants();
  unsubber = assetLink.eventBus.$on("changed:assetLogs", onAssetLogsChanged);
});
onUnmounted(() => unsubber && unsubber.$off());

const onLocationClicked = (id) => {
  if (!id) {
    return;
  }
  const clickedLocation = locationOccupants.value.find(l => l.id === id);

  router.push(`/asset/${clickedLocation.attributes.drupal_internal__id}`);
};
</script>

<template>
  <div>
    <h5 class="q-my-xs">Located here:</h5>
    <div
      class="col"
      style="
        height: auto;
        min-height: 160px;
        height: 25vh;
        position: relative;
        contain: strict;
        overflow: auto;
      "
    >
      <q-tree
        node-key="id"
        :nodes="locationOccupantNodes"
        :selected="null"
        no-nodes-label="No assets found in this location"
        @update:selected="(id) => onLocationClicked(id)"
        class="q-ml-md"
      >
        <template v-slot:default-header="prop">
          <entity-name :entity="prop.node.occupant"></entity-name>
        </template>
      </q-tree>
    </div>
  </div>
</template>

<script>
export default {
  onLoad(handle) {
    handle.defineSlot('net.symbioquine.farmos_asset_link.slots.v0.location_occupants', actionsSlot => {
      actionsSlot.type('page-slot');

      actionsSlot.showIf(context => context.pageName === 'asset-page' && context.asset.attributes.is_location);

      actionsSlot.component(handle.thisPlugin);
    });
  }
}
</script>
