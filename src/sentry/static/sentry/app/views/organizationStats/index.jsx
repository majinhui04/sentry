import _ from 'lodash';
import React from 'react';
import ApiMixin from '../../mixins/apiMixin';
import LoadingError from '../../components/loadingError';
import LoadingIndicator from '../../components/loadingIndicator';
import OrganizationHomeContainer from '../../components/organizations/homeContainer';
import StackedBarChart from '../../components/stackedBarChart';
import OrganizationState from '../../mixins/organizationState';
import Pagination from '../../components/pagination';

import ProjectTable from './projectTable';
import {t} from '../../locale';
import {intcomma} from '../../utils';

const OrganizationStats = React.createClass({
  mixins: [ApiMixin, OrganizationState],

  getInitialState() {
    let until = Math.floor(new Date().getTime() / 1000);
    let since = until - 3600 * 24 * 7;

    return {
      projectsError: false,
      projectsLoading: false,
      projectsRequestsPending: 0,
      statsError: false,
      statsLoading: false,
      statsRequestsPending: 0,
      projectMap: null,
      rawProjectData: {received: null, rejected: null, blacklisted: null},
      rawOrgData: {received: null, rejected: null, blacklisted: null},
      orgStats: null,
      orgTotal: null,
      projectTotals: null,
      querySince: since,
      queryUntil: until
    };
  },

  componentWillMount() {
    this.fetchData();
  },

  componentWillReceiveProps(nextProps) {
    // If query string changes, it will be due to pagination.
    // Intentionally only fetch projects since stats are fetched for a fixed period during
    // the initial payload
    if (nextProps.location.search !== this.props.location.search) {
      this.setState({
        projectsError: false,
        projectsRequestsPending: 1,
        projectsLoading: true
      });
    }
  },

  componentDidUpdate(prevProps) {
    let prevParams = prevProps.params, currentParams = this.props.params;

    if (prevParams.orgId !== currentParams.orgId) {
      this.fetchData();
    }

    // Query string is changed, probably due to pagination, re-fetch only project data
    if (prevProps.location.search !== this.props.location.search) {
      // Not sure why, but when we use pagination and the new results load and re-render,
      // the scroll position does not reset to top like in Audit Log
      if (window.scrollTo) {
        window.scrollTo(0, 0);
      }
      this.fetchProjectData();
    }
    let state = this.state;
    if (state.statsLoading && !state.statsRequestsPending) {
      this.processOrgData();
    }
    if (state.projectsLoading && !state.projectsRequestsPending) {
      this.processProjectData();
    }
  },

  fetchProjectData() {
    this.api.request(this.getOrganizationProjectsEndpoint(), {
      query: this.props.location.query,
      success: (data, textStatus, jqxhr) => {
        let projectMap = {};
        data.forEach(project => {
          projectMap[project.id] = project;
        });

        this.state.projectsRequestsPending -= 1;

        this.setState({
          pageLinks: jqxhr.getResponseHeader('Link'),
          projectMap: projectMap,
          projectsRequestsPending: this.state.projectsRequestsPending
        });
      },
      error: () => {
        this.setState({
          projectsError: true
        });
      }
    });
  },

  fetchData() {
    this.setState({
      statsError: false,
      statsLoading: true,
      statsRequestsPending: 3,
      projectsError: false,
      projectsLoading: true,
      projectsRequestsPending: 4
    });

    let statEndpoint = this.getOrganizationStatsEndpoint();

    _.each(this.state.rawOrgData, statName => {
      this.api.request(statEndpoint, {
        query: {
          since: this.state.querySince,
          until: this.state.queryUntil,
          resolution: '1h',
          stat: statName
        },
        success: data => {
          this.state.rawOrgData[statName] = data;
          this.state.statsRequestsPending -= 1;
          this.setState({
            rawOrgData: this.state.rawOrgData,
            statsRequestsPending: this.state.statsRequestsPending
          });
        },
        error: () => {
          this.setState({
            statsError: true
          });
        }
      });
    });

    _.each(this.state.rawProjectData, statName => {
      this.api.request(statEndpoint, {
        query: {
          since: this.state.querySince,
          until: this.state.queryUntil,
          stat: statName,
          group: 'project'
        },
        success: data => {
          this.state.rawProjectData[statName] = data;
          this.state.projectsRequestsPending -= 1;
          this.setState({
            rawProjectData: this.state.rawProjectData,
            projectsRequestsPending: this.state.projectsRequestsPending
          });
        },
        error: () => {
          this.setState({
            projectsError: true
          });
        }
      });
    });

    this.fetchProjectData();
  },

  getOrganizationStatsEndpoint() {
    let params = this.props.params;
    return '/organizations/' + params.orgId + '/stats/';
  },

  getOrganizationProjectsEndpoint() {
    let params = this.props.params;
    return '/organizations/' + params.orgId + '/projects/';
  },

  processOrgData() {
    let oReceived = 0;
    let oRejected = 0;
    let oBlacklisted = 0;
    let orgPoints = []; // accepted, rejected, blacklisted
    let aReceived = [0, 0]; // received, points
    let rawOrgData = this.state.rawOrgData;
    _.each(rawOrgData.received, (idx, point) => {
      let dReceived = point[1];
      let dRejected = rawOrgData.rejected[idx][1];
      let dBlacklisted = rawOrgData.blacklisted[idx][1];
      let dAccepted = Math.max(0, dReceived - dRejected - dBlacklisted);
      orgPoints.push({
        x: point[0],
        y: [dAccepted, dRejected, dBlacklisted]
      });
      oReceived += dReceived;
      oRejected += dRejected;
      oBlacklisted += dBlacklisted;
      if (dReceived > 0) {
        aReceived[0] += dReceived;
        aReceived[1] += 1;
      }
    });
    this.setState({
      orgStats: orgPoints,
      orgTotal: {
        received: oReceived,
        rejected: oRejected,
        blacklisted: oBlacklisted,
        accepted: Math.max(0, oReceived - oRejected - oBlacklisted),
        avgRate: aReceived[1] ? parseInt(aReceived[0] / aReceived[1] / 60, 10) : 0
      },
      statsLoading: false
    });
  },

  processProjectData() {
    let rawProjectData = this.state.rawProjectData;
    let projectTotals = [];
    _.each(rawProjectData.received, (projectId, data) => {
      let pReceived = 0;
      let pRejected = 0;
      let pBlacklisted = 0;
      _.each(data, (idx, point) => {
        pReceived += point[1];
        pRejected += rawProjectData.rejected[projectId][idx][1];
        pBlacklisted += rawProjectData.blacklisted[projectId][idx][1];
      });
      projectTotals.push({
        id: projectId,
        received: pReceived,
        rejected: pRejected,
        blacklisted: pBlacklisted,
        accepted: Math.max(0, pReceived - pRejected - pBlacklisted)
      });
    });
    this.setState({
      projectTotals: projectTotals,
      projectsLoading: false
    });
  },

  renderTooltip(point, pointIdx, chart) {
    let timeLabel = chart.getTimeLabel(point);
    let [accepted, rejected, blacklisted] = point.y;

    let value = `${intcomma(accepted)} accepted`;
    if (rejected) {
      value += `<br>${intcomma(rejected)} rate limited`;
    }
    if (blacklisted) {
      value += `<br>${intcomma(blacklisted)} filtered`;
    }

    return (
      '<div style="width:150px">' +
      `<div class="time-label">${timeLabel}</div>` +
      `<div class="value-label">${value}</div>` +
      '</div>'
    );
  },

  render() {
    return (
      <OrganizationHomeContainer>
        <h3>{t('Stats')}</h3>
        <div className="row">
          <div className="col-md-9">
            <p>
              {t(
                `The chart below reflects events the system has received
            across your entire organization. Events are broken down into
            three categories: Accepted, Rate Limited, and Filtered. Rate
            Limited events are entries that the system threw away due to quotas
            being hit, and Filtered events are events that were blocked
            due to your inbound data filter rules.`
              )}
            </p>
          </div>
          {!this.state.statsLoading &&
            <div className="col-md-3 stats-column">
              <h6 className="nav-header">{t('Events per minute')}</h6>
              <p className="count">{this.state.orgTotal.avgRate}</p>
            </div>}
        </div>
        <div className="organization-stats">
          {this.state.statsLoading
            ? <LoadingIndicator />
            : this.state.statsError
                ? <LoadingError onRetry={this.fetchData} />
                : <div className="bar-chart">
                    <StackedBarChart
                      points={this.state.orgStats}
                      height={150}
                      label="events"
                      className="standard-barchart"
                      barClasses={['accepted', 'rate-limited', 'black-listed']}
                      tooltip={this.renderTooltip}
                    />
                  </div>}
        </div>

        <div className="box">
          <div className="box-header">
            <h3>{t('Events by Project')}</h3>
          </div>
          <div className="box-content">
            {this.state.statsLoading || this.state.projectsLoading
              ? <LoadingIndicator />
              : this.state.projectsError
                  ? <LoadingError onRetry={this.fetchData} />
                  : <ProjectTable
                      projectTotals={this.state.projectTotals}
                      orgTotal={this.state.orgTotal}
                      organization={this.getOrganization()}
                      projectMap={this.state.projectMap}
                    />}
          </div>

        </div>
        {this.state.pageLinks &&
          <Pagination pageLinks={this.state.pageLinks} {...this.props} />}
      </OrganizationHomeContainer>
    );
  }
});

export default OrganizationStats;
