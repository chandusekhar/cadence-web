import Router from 'vue-router';
import Vue from 'vue';
import moment from 'moment';
import fetchMock from 'fetch-mock';
import qs from 'friendly-querystring';
import vueModal from 'vue-js-modal';
import deepmerge from 'deepmerge';

import main from '../main';
import { http } from '../helpers';
import fixtures from './fixtures';

export default function Scenario(test) {
  // eslint-disable-next-line no-param-reassign
  test.scenario = this;
  this.mochaTest = test;
  this.api = fetchMock.sandbox().catch((url, req, opts) => {
    let msg = `Unexpected request: ${url}${
      opts && opts.query ? `?${opts.query}` : ''
    }`;

    if (req.body) {
      msg += `\n${req.body}`;
    }

    mocha.throwError(new Error(msg));
  });
}

Scenario.prototype.isDebuggingJustThisTest = function isDebuggingJustThisTest() {
  return window.location.search.includes(
    encodeURIComponent(this.mochaTest.fullTitle())
  );
};

Scenario.prototype.render = function render(attachToBody) {
  const $http = http.bind(null, this.api);

  $http.post = http.post.bind(null, this.api);

  this.router = new Router({ ...main.routeOpts, mode: 'abstract' });
  this.router.push(this.initialUrl || '/');

  const el = document.createElement('div');

  if (attachToBody || this.isDebuggingJustThisTest()) {
    document.body.appendChild(el);
  }

  this.vm = new Vue({
    // vue just throws this away, not sure why
    el,
    router: this.router,
    template: '<App/>',
    components: { App: main.App },
    mixins: [
      {
        created() {
          this.$http = $http;
        },
      },
    ],
  });

  vueModal.rootInstance = this.vm;

  return this.vm.$el;
};

Scenario.prototype.go = function go(...args) {
  return [this.render(...args), this];
};

Scenario.prototype.startingAt = function startingAt(url) {
  this.initialUrl = url;

  return this;
};

Scenario.prototype.tearDown = function tearDown() {
  if (
    this.vm &&
    this.vm.$el &&
    this.vm.$el.parentElement &&
    // as a convience, if debugging just this test, don't remove the test app
    !this.isDebuggingJustThisTest()
  ) {
    this.vm.$el.parentElement.removeChild(this.vm.$el);
  }

  delete window.Mocha.copiedText;

  const unmatched = this.api.calls(false);
  return unmatched.length
    ? Promise.reject(
        new Error(`${unmatched.length} outstanding expected API calls:
      ${unmatched
        .slice(0, 5)
        .map(([url]) => url)
        .join('\n')}`)
      )
    : Promise.resolve();
};

Object.defineProperty(Scenario.prototype, 'location', {
  get() {
    return this.router.history.getCurrentLocation();
  },
});

Scenario.prototype.withDomain = function withDomain(domain) {
  this.domain = domain;

  return this;
};

Scenario.prototype.withDomainAuthorization = function withDomainAuthorization(
  domain,
  authorization
) {
  this.api.getOnce(`/api/domains/${domain}/authorization`, {
    authorization,
  });

  return this;
};

Scenario.prototype.withDomainDescription = function withDomainDescription(
  domain,
  domainDesc
) {
  this.api.getOnce(
    `/api/domains/${domain}`,
    deepmerge(
      {
        domainInfo: {
          name: domain,
          status: 'REGISTERED',
          description: 'A cool domain',
          ownerEmail: 'ci-test@uber.com',
        },
        configuration: {
          workflowExecutionRetentionPeriodInDays: 21,
          emitMetric: true,
          historyArchivalStatus: 'ENABLED',
          visibilityArchivalStatus: 'DISABLED',
        },
        replicationConfiguration: {
          activeClusterName: 'ci-test-cluster',
          clusters: [
            {
              clusterName: 'ci-test-cluster',
            },
          ],
        },
        failoverVersion: 0,
        isGlobalDomain: false,
      },
      domainDesc || {}
    ),
    { overwriteRoutes: false }
  );

  return this;
};

Scenario.prototype.withFeatureFlags = function withFeatureFlags(featureFlags = []) {
  featureFlags.forEach(({ key, value }) => {
    this.api.getOnce(`/api/feature-flags/${key}`, {
      key,
      value,
    });
  });

  return this;
};

Scenario.prototype.withNewsFeed = function withNewsFeed() {
  this.api.getOnce('/feed.json', {
    version: 'https://jsonfeed.org/version/1',
    title: '',
    home_page_url: '/',
    feed_url: '/feed.json',
    items: [
      {
        id: '/_news/2019/05/05/writing-a-vuepress-theme-2/',
        url: '/_news/2019/05/05/writing-a-vuepress-theme-2/',
        title: 'Writing a VuePress theme',
        summary: 'To write a theme, create a .vuepress/theme directory ...',
        date_modified: '2019-05-06T00:00:00.000Z',
      },
      {
        id: '/_news/2019/02/25/markdown-slot-3/',
        url: '/_news/2019/02/25/markdown-slot-3/',
        title: 'Markdown Slot',
        summary:
          'VuePress implements a content distribution API for Markdown...',
        date_modified: '2019-02-26T00:00:00.000Z',
      },
    ],
  });

  return this;
};

Scenario.prototype.withWorkflows = function withWorkflows(
  status,
  query,
  workflows
) {
  if (!workflows) {
    // eslint-disable-next-line no-param-reassign
    workflows = JSON.parse(JSON.stringify(fixtures.workflows[status]));
  }

  const startTimeDays = status === 'open' ? 30 : 21;
  const url = `/api/domains/${this.domain}/workflows/${status}?${qs.stringify({
    startTime: moment()
      .subtract(startTimeDays, 'day')
      .startOf('day')
      .toISOString(),
    endTime: moment()
      .endOf('day')
      .toISOString(),
    ...query,
  })}`;

  const response = Array.isArray(workflows)
    ? { executions: workflows }
    : workflows;

  this.api.getOnce(url, response);

  return this;
};

Scenario.prototype.execApiBase = function execApiBase(workflowId, runId) {
  return `/api/domains/${this.domain}/workflows/${encodeURIComponent(
    workflowId || this.workflowId
  )}/${encodeURIComponent(runId || this.runId)}`;
};

Scenario.prototype.withWorkflow = function withWorkflow(
  workflowId,
  runId,
  description
) {
  this.workflowId = workflowId;
  this.runId = runId;

  this.api.getOnce(this.execApiBase(), {
    executionConfiguration: {
      taskList: { name: 'ci_task_list' },
      executionStartToCloseTimeoutSeconds: 3600,
      taskStartToCloseTimeoutSeconds: 10,
      childPolicy: 'TERMINATE',
    },
    workflowExecutionInfo: {
      execution: { workflowId, runId },
      type: { name: 'CIDemoWorkflow' },
      startTime: moment()
        .startOf('hour')
        .subtract(2, 'minutes'),
      historyLength: 14,
    },
    ...(description || {}),
  });

  return this;
};

Scenario.prototype.withHistory = function withHistory(events, hasMorePages) {
  if (!this.historyNpt) {
    this.historyNpt = {};
  }

  const makeToken = () =>
    btoa(
      JSON.stringify({
        NextEventId: this.historyNpt[this.runId],
        IsWorkflowRunning: true,
      })
    );

  let url = `${this.execApiBase()}/history?waitForNewEvent=true`;
  const response = Array.isArray(events) ? { history: { events } } : events;

  if (this.historyNpt[this.runId]) {
    url += `&nextPageToken=${encodeURIComponent(makeToken())}`;
  }

  if (hasMorePages) {
    this.historyNpt[this.runId] =
      (this.historyNpt[this.runId] || 0) + response.history.events.length + 1;
    response.nextPageToken = makeToken();
  }

  this.api.getOnce(url, response, { delay: 100 });

  return this;
};

Scenario.prototype.withFullHistory = function withFullHistory(events) {
  const parsedEvents = JSON.parse(
    JSON.stringify(events || fixtures.history.emailRun1)
  );
  const third = Math.floor(parsedEvents.length / 3);

  return this.withHistory(parsedEvents.slice(0, third), true)
    .withHistory(parsedEvents.slice(third, third + third), true)
    .withHistory(parsedEvents.slice(third + third));
};

Scenario.prototype.withQuery = function withQuery(query) {
  this.api.getOnce(
    `${this.execApiBase()}/query`,
    query || ['__stack_trace', 'status']
  );

  return this;
};

Scenario.prototype.withQueryResult = function withQueryResult(query, result) {
  this.api.postOnce(
    `${this.execApiBase()}/query/${query}`,
    result && result.status ? result : { queryResult: result }
  );

  return this;
};

Scenario.prototype.withWorkflowTermination = function withWorkflowTermination(
  workflowId,
  runId,
  reason
) {
  this.api.postOnce(`${this.execApiBase()}/terminate`, { reason });

  return this;
};

Scenario.prototype.withTaskListPollers = function withTaskListPollers(
  taskList,
  pollers
) {
  this.api.getOnce(
    `/api/domains/${this.domain}/task-lists/${taskList}/pollers`,
    pollers || {
      node1: {
        lastAccessTime: moment()
          .startOf('hour')
          .add(5, 'minutes'),
        taskListTypes: ['decision', 'activity'],
      },
      node2: {
        lastAccessTime: moment()
          .startOf('hour')
          .add(3, 'minutes'),
        taskListTypes: ['decision'],
      },
      node3: {
        lastAccessTime: moment()
          .startOf('hour')
          .add(4, 'minutes'),
        taskListTypes: ['activity'],
      },
    }
  );

  return this;
};

window.Scenario = Scenario;
