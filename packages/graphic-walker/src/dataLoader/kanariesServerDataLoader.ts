import produce, { enableMapSet } from 'immer';
import type { IDataQueryPayload, IResponse, IRow } from '../interfaces';
import type { GWTransformFunction, IGWDataLoader } from ".";


enableMapSet();

interface IGWTransformerOptions {
    server: string;
}

export default class KanariesServerDataLoader implements IGWDataLoader {

    constructor(protected readonly options: IGWTransformerOptions) {}

    async #query(data: IDataQueryPayload): Promise<IRow[]> {
        const res = await fetch(`${this.options.server}/api/data/v1/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });
        if (res.status === 200 || res.status === 500) {
            const result = await res.json() as IResponse<IRow[]>;
            if (result.success === false) {
                throw new Error(result.message);
            }
            return result.data;
        } else {
            throw new Error(`Failed to query data from server. ${res.status}: ${res.statusText}`);
        }
    }

    transform: GWTransformFunction = async payload => {
        const data = produce(payload, draft => {
            for (const step of draft.workflow) {
                if (step.type === 'filter') {
                    for (const filter of step.filters) {
                        if (filter.rule.type === 'one of') {
                            // @ts-expect-error - stringify all sets as array
                            filter.rule.value = Array.from(filter.rule.value);
                        }
                    }
                }
            }
        });
        return this.#query(data);
    };

    statField: IGWDataLoader['statField'] = async (dataset, fid, { values = false, range = false }) => {
        const COUNT_ID = `count_${fid}`;
        const MIN_ID = `min_${fid}`;
        const MAX_ID = `max_${fid}`;
        const valuesQueryPayload: IDataQueryPayload = {
            datasetId: dataset.id,
            workflow: [{
                type: 'view',
                query: [{
                    op: 'aggregate',
                    groupBy: [fid],
                    measures: [{
                        field: fid,
                        agg: 'count',
                        asFieldKey: COUNT_ID,
                    }],
                }],
            }],
        };
        const valuesRes = values ? await this.#query(valuesQueryPayload) : [];
        const rangeQueryPayload: IDataQueryPayload = {
            datasetId: dataset.id,
            workflow: [{
                type: 'view',
                query: [{
                    op: 'aggregate',
                    groupBy: [],
                    measures: [{
                        field: fid,
                        agg: 'min',
                        asFieldKey: MIN_ID,
                    }, {
                        field: fid,
                        agg: 'max',
                        asFieldKey: MAX_ID,
                    }],
                }],
            }],
        };
        const [rangeRes] = range ? await this.#query(rangeQueryPayload) : [{
            [MIN_ID]: 0,
            [MAX_ID]: 0,
        }];

        return {
            values: valuesRes.sort((a, b) => b[COUNT_ID] - a[COUNT_ID]).slice(0, 20).map(row => ({
                value: row[fid],
                count: row[COUNT_ID],
            })),
            range: [rangeRes[MIN_ID], rangeRes[MAX_ID]],
        };
    };

}
