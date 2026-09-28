import { describe, expect, it } from 'vitest';
import { getEventsKafkaBrokers, getHlfKafkaBrokers, getKafkaConnectionMode, getLocalKafkaBrokers } from './config.js';

const IN_CLUSTER_EVENTS = 'kafka.roadwatch.svc.cluster.local:9092';
const MANAGED_EVENTS = 'pkc-abc.europe-west1.gcp.confluent.cloud:9092';

describe('kafka broker resolution', () => {
  it('prefers managed events brokers over the in-cluster ones', () => {
    const env = {
      KAFKA_EVENTS_BROKERS: IN_CLUSTER_EVENTS,
      KAFKA_EVENTS_CLOUD_BROKERS: MANAGED_EVENTS,
    } as NodeJS.ProcessEnv;

    expect(getEventsKafkaBrokers(env)).toEqual([MANAGED_EVENTS]);
  });

  it('accepts KAFKA_EVENTS_MANAGED_BROKERS as an alias', () => {
    const env = {
      KAFKA_EVENTS_BROKERS: IN_CLUSTER_EVENTS,
      KAFKA_EVENTS_MANAGED_BROKERS: MANAGED_EVENTS,
    } as NodeJS.ProcessEnv;

    expect(getEventsKafkaBrokers(env)).toEqual([MANAGED_EVENTS]);
  });

  it('prefers managed HLF brokers over the in-cluster ones', () => {
    const env = {
      KAFKA_HLF_BROKERS: 'kafka-hlf.roadwatch.svc.cluster.local:9092',
      KAFKA_HLF_CLOUD_BROKERS: MANAGED_EVENTS,
    } as NodeJS.ProcessEnv;

    expect(getHlfKafkaBrokers(env)).toEqual([MANAGED_EVENTS]);
  });

  it('falls back to the in-cluster brokers when no managed value is set', () => {
    const env = { KAFKA_EVENTS_BROKERS: IN_CLUSTER_EVENTS } as NodeJS.ProcessEnv;
    expect(getEventsKafkaBrokers(env)).toEqual([IN_CLUSTER_EVENTS]);
  });

  it('splits a comma-separated managed broker list', () => {
    const env = {
      KAFKA_EVENTS_CLOUD_BROKERS: 'a.example:9092, b.example:9092 ,c.example:9092',
    } as NodeJS.ProcessEnv;

    expect(getEventsKafkaBrokers(env)).toEqual([
      'a.example:9092',
      'b.example:9092',
      'c.example:9092',
    ]);
  });

  it('still honours the legacy shared alias for the HLF cluster', () => {
    // The resolver applies KAFKA_BROKERS to the events cluster only, but the
    // HLF cluster has historically accepted it too. Removing that would change
    // which deployments resolve, so it is pinned here.
    const env = { KAFKA_BROKERS: 'legacy:9092' } as NodeJS.ProcessEnv;
    expect(getHlfKafkaBrokers(env)).toEqual(['legacy:9092']);
    expect(getEventsKafkaBrokers(env)).toEqual(['legacy:9092']);
  });

  it('returns null when nothing is configured', () => {
    expect(getEventsKafkaBrokers({} as NodeJS.ProcessEnv)).toBeNull();
    expect(getHlfKafkaBrokers({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('reports a configured mode when only a managed endpoint is set', () => {
    const env = { KAFKA_EVENTS_CLOUD_BROKERS: MANAGED_EVENTS } as NodeJS.ProcessEnv;
    expect(getKafkaConnectionMode(env)).toBe('local');
  });

  it('still resolves the local development default through the deprecated helper', () => {
    // getLocalKafkaBrokers carries the 127.0.0.1:9095 fallback that
    // KafkaClient relies on, so it must keep working even with no env at all.
    expect(getLocalKafkaBrokers({} as NodeJS.ProcessEnv)).toEqual(['127.0.0.1:9095']);
  });

  it('names the managed variables in the error when unconfigured', () => {
    expect(() => getKafkaConnectionMode({} as NodeJS.ProcessEnv)).toThrow(
      /KAFKA_EVENTS_CLOUD_BROKERS/,
    );
  });
});
