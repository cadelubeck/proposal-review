-- Public discovery sources available to every authenticated organization. These
-- are screening/index sources, not automatically controlling requirements.
insert into public.app_records (kind, id, company_id, data)
values
  ('standard', 'shared-usgs-earthquake-hazards', '_shared', jsonb_build_object(
    'id', 'shared-usgs-earthquake-hazards', 'title', 'USGS Earthquake Hazards Program',
    'documentType', 'hazard_database', 'sourceCategory', 'natural_hazards',
    'jurisdiction', 'United States', 'client', '', 'projectTypes', '[]'::jsonb,
    'sourceUrl', 'https://www.usgs.gov/programs/earthquake-hazards',
    'visibility', 'shared', 'sensitivity', 'public', 'requirements', '[]'::jsonb,
    'extractionStatus', 'url_only', 'createdAt', now(), 'createdById', 'system-seed',
    'health', jsonb_build_object('status', 'unchecked', 'checkedAt', null, 'changed', false)
  )),
  ('standard', 'shared-usgs-groundwater', '_shared', jsonb_build_object(
    'id', 'shared-usgs-groundwater', 'title', 'USGS Groundwater Data for the Nation',
    'documentType', 'groundwater_database', 'sourceCategory', 'site_subsurface',
    'jurisdiction', 'United States', 'client', '', 'projectTypes', '[]'::jsonb,
    'sourceUrl', 'https://waterdata.usgs.gov/nwis/gw',
    'visibility', 'shared', 'sensitivity', 'public', 'requirements', '[]'::jsonb,
    'extractionStatus', 'url_only', 'createdAt', now(), 'createdById', 'system-seed',
    'health', jsonb_build_object('status', 'unchecked', 'checkedAt', null, 'changed', false)
  )),
  ('standard', 'shared-usgs-national-map', '_shared', jsonb_build_object(
    'id', 'shared-usgs-national-map', 'title', 'USGS The National Map',
    'documentType', 'gis_database', 'sourceCategory', 'gis_survey',
    'jurisdiction', 'United States', 'client', '', 'projectTypes', '[]'::jsonb,
    'sourceUrl', 'https://www.usgs.gov/programs/national-geospatial-program/national-map',
    'visibility', 'shared', 'sensitivity', 'public', 'requirements', '[]'::jsonb,
    'extractionStatus', 'url_only', 'createdAt', now(), 'createdById', 'system-seed',
    'health', jsonb_build_object('status', 'unchecked', 'checkedAt', null, 'changed', false)
  )),
  ('standard', 'shared-fema-flood-maps', '_shared', jsonb_build_object(
    'id', 'shared-fema-flood-maps', 'title', 'FEMA Flood Map Service Center',
    'documentType', 'flood_database', 'sourceCategory', 'natural_hazards',
    'jurisdiction', 'United States', 'client', '', 'projectTypes', '[]'::jsonb,
    'sourceUrl', 'https://msc.fema.gov/portal/home',
    'visibility', 'shared', 'sensitivity', 'public', 'requirements', '[]'::jsonb,
    'extractionStatus', 'url_only', 'createdAt', now(), 'createdById', 'system-seed',
    'health', jsonb_build_object('status', 'unchecked', 'checkedAt', null, 'changed', false)
  )),
  ('standard', 'shared-epa-cleanups', '_shared', jsonb_build_object(
    'id', 'shared-epa-cleanups', 'title', 'EPA Site-Specific National Cleanup Databases',
    'documentType', 'contamination_database', 'sourceCategory', 'site_subsurface',
    'jurisdiction', 'United States', 'client', '', 'projectTypes', '[]'::jsonb,
    'sourceUrl', 'https://www.epa.gov/cleanups/site-specific-national-cleanup-databases',
    'visibility', 'shared', 'sensitivity', 'public', 'requirements', '[]'::jsonb,
    'extractionStatus', 'url_only', 'createdAt', now(), 'createdById', 'system-seed',
    'health', jsonb_build_object('status', 'unchecked', 'checkedAt', null, 'changed', false)
  )),
  ('standard', 'shared-fhwa-mutcd', '_shared', jsonb_build_object(
    'id', 'shared-fhwa-mutcd', 'title', 'FHWA Manual on Uniform Traffic Control Devices',
    'documentType', 'national_standard', 'sourceCategory', 'applicable_codes',
    'jurisdiction', 'United States', 'client', '', 'projectTypes', jsonb_build_array('transportation'),
    'sourceUrl', 'https://mutcd.fhwa.dot.gov/',
    'visibility', 'shared', 'sensitivity', 'public', 'requirements', '[]'::jsonb,
    'extractionStatus', 'url_only', 'createdAt', now(), 'createdById', 'system-seed',
    'health', jsonb_build_object('status', 'unchecked', 'checkedAt', null, 'changed', false)
  )),
  ('standard', 'shared-jones-civil', '_shared', jsonb_build_object(
    'id', 'shared-jones-civil', 'title', 'Jones & Associates Public Project Portal',
    'documentType', 'project_portal', 'sourceCategory', 'project_documents',
    'jurisdiction', 'Utah', 'client', 'Jones & Associates', 'projectTypes', '[]'::jsonb,
    'sourceUrl', 'https://jonescivil.com/',
    'visibility', 'shared', 'sensitivity', 'public', 'requirements', '[]'::jsonb,
    'extractionStatus', 'url_only', 'createdAt', now(), 'createdById', 'system-seed',
    'health', jsonb_build_object('status', 'unchecked', 'checkedAt', null, 'changed', false)
  ))
on conflict (kind, id) do nothing;
